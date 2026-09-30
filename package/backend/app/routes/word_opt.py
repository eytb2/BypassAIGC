import os
import shutil
import tempfile
from typing import Optional, List, Dict, Any
from urllib.parse import quote
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query, Depends, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.config import settings
from app.services.ai_service import AIService
from app.services.word_opt_service import (
    parse_docx_to_session,
    get_session,
    save_session,
    list_sessions,
    delete_session,
    generate_3_suggestions,
    apply_sentence_suggestion,
    restore_sentence_original,
    export_modified_docx,
    process_word_session_full,
    batch_apply_all_suggestions,
)

router = APIRouter(prefix="/word-opt", tags=["word-optimization"])


class GenerateSuggestionRequest(BaseModel):
    sentence_id: str
    force: Optional[bool] = False


class ApplySuggestionRequest(BaseModel):
    sentence_id: str
    selected_text: str
    suggestion_id: Optional[int] = None


class RestoreSentenceRequest(BaseModel):
    sentence_id: str


async def prefetch_suggestions_background(session_id: str):
    """在后台为会话中的标红句子自动预生成 3 条修改建议"""
    session = get_session(session_id)
    if not session:
        return

    mode = session.get("processing_mode", "paper_polish_enhance")

    ai_service = AIService(
        model=settings.POLISH_MODEL,
        api_key=settings.POLISH_API_KEY,
        base_url=settings.POLISH_BASE_URL
    )

    updated = False
    for p in session["paragraphs"]:
        context = p["original_text"]
        for s in p["sentences"]:
            if s.get("needs_mod") and not s.get("suggestions"):
                try:
                    res = await generate_3_suggestions(s["original_text"], context, ai_service, mode=mode)
                    s["reason"] = res.get("reason", "高危AI模板句式")
                    s["suggestions"] = res.get("suggestions", [])
                    updated = True
                except Exception as e:
                    print(f"[WARN] prefetch failed for {s['id']}: {e}")

    if updated:
        save_session(session)


def is_admin_user(user: User) -> bool:
    return bool(getattr(user, "is_admin", False) or user.card_key == "AIGC888888")


def get_user_word_session(
    session_id: str,
    card_key: Optional[str] = Query(None),
    db: Session = Depends(get_db)
) -> tuple:
    """统一校验用户身份与 Word 会话归属（防越权 IDOR）"""
    if not card_key:
        raise HTTPException(status_code=401, detail="缺少卡密")

    user = db.query(User).filter(User.card_key == card_key, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="无效的卡密")

    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    is_admin = is_admin_user(user)
    if not is_admin and session.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="会话不存在或无权访问")

    return session, user


@router.post("/upload")
async def upload_docx(
    file: UploadFile = File(...),
    processing_mode: Optional[str] = Form(None),
    mode_q: Optional[str] = Query(None, alias="processing_mode"),
    background_tasks: BackgroundTasks = None,
    card_key: Optional[str] = Query(None),
    card_key_f: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """上传 Word (.docx) 文件并初始化降重分析会话"""
    if not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="目前仅支持上传 .docx 格式的 Word 文档")

    effective_card_key = card_key or card_key_f
    if not effective_card_key:
        raise HTTPException(status_code=401, detail="缺少卡密，请先登录")

    user = db.query(User).filter(User.card_key == effective_card_key, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="无效的卡密")

    mode = processing_mode or mode_q or "paper_polish_enhance"
    valid_modes = ['paper_polish', 'paper_enhance', 'paper_polish_enhance', 'emotion_polish']
    if mode not in valid_modes:
        mode = "paper_polish_enhance"

    user_id = user.id
    user_email = user.email

    # 临时落盘
    with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        session_data = parse_docx_to_session(
            tmp_path,
            file.filename,
            processing_mode=mode,
            user_id=user_id,
            user_email=user_email
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Word 文档解析失败: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    # 启动后台全量检索与优化建议生成任务（txt优化同款异步处理机制）
    if background_tasks:
        background_tasks.add_task(process_word_session_full, session_data["session_id"])

    return session_data


@router.get("/session/{session_id}/progress")
async def get_word_session_progress(session_and_user: tuple = Depends(get_user_word_session)):
    """获取 Word 会话的优化处理进度（与 txt 优化进度接口对齐）"""
    session, _ = session_and_user
    return {
        "session_id": session["session_id"],
        "filename": session.get("filename"),
        "processing_mode": session.get("processing_mode", "paper_polish_enhance"),
        "status": session.get("status", "completed"),
        "progress": session.get("progress", 100.0),
        "current_stage": session.get("current_stage", "completed"),
        "current_position": session.get("current_position", 0),
        "total_to_process": session.get("total_to_process", session.get("need_mod_count", 0)),
        "need_mod_count": session.get("need_mod_count", 0),
        "modified_count": session.get("modified_count", 0),
        "error_message": session.get("error_message")
    }


@router.get("/session/{session_id}")
async def get_word_session(session_and_user: tuple = Depends(get_user_word_session)):
    """获取会话当前状态与文档数据"""
    session, _ = session_and_user
    return session


@router.post("/session/{session_id}/generate-suggestion")
async def generate_suggestion_for_sentence(
    req: GenerateSuggestionRequest,
    session_and_user: tuple = Depends(get_user_word_session)
):
    """按需为特定句子生成 3 条修改建议"""
    session, _ = session_and_user
    session_id = session["session_id"]

    mode = session.get("processing_mode", "paper_polish_enhance")

    target_sentence = None
    target_context = ""

    for p in session["paragraphs"]:
        for s in p["sentences"]:
            if s["id"] == req.sentence_id:
                target_sentence = s
                target_context = p["original_text"]
                break
        if target_sentence:
            break

    if not target_sentence:
        raise HTTPException(status_code=404, detail=f"未找到句子: {req.sentence_id}")

    # 若未要求强制重生成且已缓存建议则直接返回
    if not req.force and target_sentence.get("suggestions") and len(target_sentence["suggestions"]) >= 3:
        return {
            "sentence_id": req.sentence_id,
            "reason": target_sentence.get("reason"),
            "suggestions": target_sentence["suggestions"]
        }

    ai_service = AIService(
        model=settings.POLISH_MODEL,
        api_key=settings.POLISH_API_KEY,
        base_url=settings.POLISH_BASE_URL
    )

    res = await generate_3_suggestions(target_sentence["original_text"], target_context, ai_service, mode=mode)
    target_sentence["reason"] = res.get("reason", "高危AI模板句式")
    target_sentence["suggestions"] = res.get("suggestions", [])

    save_session(session)

    return {
        "sentence_id": req.sentence_id,
        "reason": target_sentence["reason"],
        "suggestions": target_sentence["suggestions"]
    }


@router.post("/session/{session_id}/apply")
async def apply_suggestion(
    req: ApplySuggestionRequest,
    session_and_user: tuple = Depends(get_user_word_session)
):
    """确认采纳某一建议"""
    session, _ = session_and_user
    session_id = session["session_id"]
    try:
        updated = apply_sentence_suggestion(
            session_id=session_id,
            sentence_id=req.sentence_id,
            selected_text=req.selected_text,
            suggestion_id=req.suggestion_id
        )
        return updated
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"应用修改失败: {str(e)}")


@router.post("/session/{session_id}/restore")
async def restore_sentence(
    req: RestoreSentenceRequest,
    session_and_user: tuple = Depends(get_user_word_session)
):
    """还原句子为原始状态"""
    session, _ = session_and_user
    session_id = session["session_id"]
    try:
        updated = restore_sentence_original(session_id, req.sentence_id)
        return updated
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"还原失败: {str(e)}")


@router.get("/session/{session_id}/docx")
async def get_word_docx_file(session_and_user: tuple = Depends(get_user_word_session)):
    """获取当前 Word 会话的 docx 二进制文件（供 docx-preview 标准在线预览渲染）"""
    session, _ = session_and_user
    session_id = session["session_id"]
    try:
        stream = export_modified_docx(session_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取 Word 文档失败: {str(e)}")

    filename = session.get("filename", "document.docx")
    encoded_filename = quote(filename)

    return Response(
        content=stream.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


@router.get("/session/{session_id}/export")
async def export_word(session_and_user: tuple = Depends(get_user_word_session)):
    """导出替换修改后的 Word (.docx) 文件"""
    session, _ = session_and_user
    session_id = session["session_id"]
    try:
        stream = export_modified_docx(session_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成 Word 导出失败: {str(e)}")

    filename = session.get("filename", "document.docx")
    encoded_filename = quote(f"[已降重]_{filename}")

    return Response(
        content=stream.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


@router.get("/sessions")
async def list_word_sessions(
    card_key: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """获取 Word 降重历史会话列表（按用户或管理员权限隔离）"""
    if not card_key:
        raise HTTPException(status_code=401, detail="缺少卡密")

    user = db.query(User).filter(User.card_key == card_key, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="无效的卡密")

    is_admin = is_admin_user(user)

    user_dict = None
    if is_admin:
        all_users = db.query(User).all()
        user_dict = {u.id: {"email": u.email, "is_admin": getattr(u, "is_admin", False)} for u in all_users}

    return list_sessions(user_id=user.id, is_admin=is_admin, user_dict=user_dict, email_filter=email)


@router.delete("/session/{session_id}")
async def remove_word_session(
    session_id: str,
    card_key: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """删除指定 Word 会话（仅所有者或管理员可删）"""
    if not card_key:
        raise HTTPException(status_code=401, detail="缺少卡密")

    user = db.query(User).filter(User.card_key == card_key, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="无效的卡密")

    is_admin = is_admin_user(user)
    success = delete_session(session_id, user_id=user.id, is_admin=is_admin)
    if not success:
        raise HTTPException(status_code=404, detail="会话不存在或无权删除")
    return {"message": "会话已删除"}


@router.post("/session/{session_id}/apply-all")
async def batch_apply_all(session_and_user: tuple = Depends(get_user_word_session)):
    """一键采纳所有具备生成方案的待修改语句（默认采用第一条推荐方案）"""
    session, _ = session_and_user
    session_id = session["session_id"]
    if session.get("status") == "processing":
        raise HTTPException(status_code=400, detail="后台正在全量检索与生成建议，请待完成后再一键采纳")

    result = batch_apply_all_suggestions(session_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

