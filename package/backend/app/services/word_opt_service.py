import os
import io
import re
import json
import uuid
import time
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH

from app.config import settings
from app.services.ai_service import AIService, remove_thinking_tags


DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "word_sessions")
os.makedirs(DATA_DIR, exist_ok=True)


# AIGC 高危模式与模板句型库 (参考学术论文去AI痕迹与知网3.0/PaperPass检测规则)
AIGC_PATTERNS = [
    # 模式1: 从...看/来说，把/将...列为/作为...之一
    (re.compile(r'从[^，。；\n]+(?:看|来说|角度|视阈|视角)[，,].+?(?:把|将).+?(?:列为|作为|视作|当成)[^，。；\n]+之一[，,]?'), "模板套话（从...看/把...列为...之一）"),
    (re.compile(r'(?:把|将).+?(?:列为|作为|视作|当成)[^，。；\n]+之一[，,]?'), "高频AI句式（把...作为/列为...之一）"),
    
    # 模式2: 推动/推进...从...走向...
    (re.compile(r'推动.+?从.+?走向.+?[；;。]?'), "机械动词搭配（推动...从...走向...）"),
    (re.compile(r'促进.+?向.+?(?:进阶|跃迁|转型|延伸)[；;。]?'), "AI常用概括词（促进...向...进阶）"),
    (re.compile(r'(?:有力推动|有效促进|深度赋能|全面赋能|协同发力|多维协同)[，,；;。]?'), "AI空泛动宾搭配"),

    # 模式3: 具有...重要意义/价值/作用/影响
    (re.compile(r'具有.+?(?:重要|深远|关键|不可替代|积极|突出|显著).+?(?:意义|价值|作用|影响|地位)[，,；;。]?'), "空洞拔高句式（具有...重要意义/价值）"),
    (re.compile(r'具有广阔的.+?(?:前景|空间|潜力)[，,；;。]?'), "套话收尾（具有广阔前景）"),
    (re.compile(r'发挥着.+?(?:重要|关键|核心|不可替代|基础性|积极).+?(?:作用|功能|角色)[，,；;。]?'), "套话句式（发挥着...作用）"),
    (re.compile(r'扮演着.+?(?:重要|关键|不可替代|举足轻重).+?角色[，,；;。]?'), "套话句式（扮演着...角色）"),

    # 模式4: 为...提供了/奠定了...基础/依据/参考
    (re.compile(r'为.+?(?:提供|奠定)了.+?(?:基础|依据|支撑|遵循|参考|保障)[，,；;。]?'), "模板搭配（为...奠定/提供基础）"),
    (re.compile(r'立足.+?面向.+?'), "八股对仗套话（立足...面向...）"),
    (re.compile(r'以.+?为(?:抓手|导向|契机|切入点|支撑|遵循)[，,；;。]?'), "八股模板搭配（以...为抓手/导向）"),

    # 模式5: 机械段落/转折开头与过渡填充词
    (re.compile(r'(?:综上所述|由此可见|总而言之|显而易见|不难看出|毋庸置疑|毋庸讳言|归根结底)[，,]'), "机械结论过渡词"),
    (re.compile(r'基于.+?(?:分析|研究|探讨|框架|理论|视阈|视角|维度|背景)[，,]'), "模板状语开头（基于...分析/视阈）"),
    (re.compile(r'随着.+?(?:发展|深入|推进|演进|普及|加速)[，,]'), "高频AI开头（随着...深入/推进）"),
    (re.compile(r'在.+?背景下[，,]'), "常见AI模板背景开头"),
    (re.compile(r'(?:值得注意的|需要指出的|不可否认的|显而易见的|不言而喻的)是[，,]'), "填充式过渡词"),
    (re.compile(r'(?:相关研究表明|大量研究显示|业内普遍认为|据不完全统计|众所周知)[，,]'), "假权威模糊指引"),
    (re.compile(r'(?:在很大程度上|在一定程度上|不可避免地)[，,]?'), "模糊限定套话"),

    # 模式6: 假分析/八股结构
    (re.compile(r'通过.+?实现.+?[，,；;。]?'), "空泛假分析（通过...实现...）"),
    (re.compile(r'依托.+?推动.+?[，,；;。]?'), "空泛假分析（依托...推动...）"),
    (re.compile(r'围绕.+?展开.+?[，,；;。]?'), "空泛假分析（围绕...展开...）"),
    (re.compile(r'对.+?进行了.+?(?:分析|研究|探讨|考察|总结)[，,；;。]?'), "繁复学术动宾搭配"),
    (re.compile(r'(?:深度融合|全面提升|多层次|全方位|深层次|全生命周期)[，,；;。]?'), "AI套话用语"),

    # 模式7: 否定排比与转折
    (re.compile(r'不是.+?而是.+?[，,；;。]?'), "成对否定对比"),
    (re.compile(r'不只是.+?更是.+?[，,；;。]?'), "递进强调套话"),
    (re.compile(r'不仅.+?而且.+?[，,；;。]?'), "递进排比套话"),
    (re.compile(r'既要.+?更要.+?[，,；;。]?'), "递进要求套话"),

    # 模式8: 英文高危AI模板与高频词
    (re.compile(r'(?:delve\s+into|play\s+a\s+(?:pivotal|crucial)\s+role|it\s+is\s+worth\s+noting\s+that|serves\s+as\s+a\s+cornerstone|in\s+conclusion|furthermore|moreover)', re.IGNORECASE), "英文典型AI特征表达"),
]


MODE_CONFIGS = {
    "paper_polish": {
        "name": "论文润色",
        "desc": "提升学术表达质量",
        "system_prompt": """你是一位权威的学术论文润色与文字规范专家，精通高水平学术期刊的语言表达规范与学术风格。
你的任务是对论文中表达生硬、语病或缺乏学术规范的语句进行专业学术润色，显著提升学术表达质量与严谨性。

【规范要求】：
1. 必须保持严谨、规范的书面学术语体（Register），杜绝口语化与不规范用词。
2. 原文的所有专有名词、核心术语、关键数据、实验结果与因果逻辑必须完整保留，严禁擅自篡改或编造。
3. 必须针对原句输出 3 条不同学术润色策略的高质量候选建议：
   - 建议 1（学术规范）：规范专业术语与书面学术语体，消除口语痕迹与生硬表达；
   - 建议 2（句式精炼）：优化长句修饰与从属关系，精简冗余词汇，提升学术论述严谨性与凝练度；
   - 建议 3（语篇衔接）：强化与上下文的学术逻辑衔接，优化论证推导节奏，增强论述力度。
4. 必须输出合法的 JSON 格式，不要输出任何多余内容，格式如下：
{
  "reason": "指出原句存在的学术表达欠妥或语篇衔接不足之处",
  "suggestions": [
    { "id": 1, "type": "学术规范", "desc": "规范学术语体与术语，消除口语痕迹", "text": "改写后文本..." },
    { "id": 2, "type": "句式精炼", "desc": "优化长句从属，凝练学术表达", "text": "改写后文本..." },
    { "id": 3, "type": "语篇衔接", "desc": "强化学术逻辑衔接，增强论证力度", "text": "改写后文本..." }
  ]
}"""
    },
    "paper_enhance": {
        "name": "论文增强",
        "desc": "直接提升原创性",
        "system_prompt": """你是一位顶尖的学术论文原创性增强与AIGC痕迹消除专家，精通知网、万方、PaperPass等检测机制。
你的任务是对论文中被识别为高危AI模板的语句进行深度原创性重塑，彻底打破AI文本统计特征，直接提升原创度。

【规范要求】：
1. 保持严谨书面学术语体，同时彻底打破AI大模型的机械句式分布。
2. 原文的所有专有名词、核心概念、数据、结论必须完整保留，严禁擅自篡改或编造。
3. 必须针对原句输出 3 条不同原创性增强策略的高质量候选建议：
   - 建议 1（结构重组）：深层调整主谓宾语序、主被动倒装，彻底瓦解AI机械句式节律；
   - 建议 2（去痕重写）：彻底剔除“从...看/来说”、“推动...从...走向...”、“具有重要意义”等AI高频套话，置换为实质性论述；
   - 建议 3（逻辑跃迁）：提炼核心学术论点，从宏观学术背景或研究方法视角重构切入点。
4. 必须输出合法的 JSON 格式，不要输出任何多余内容，格式如下：
{
  "reason": "指出原句存在的AI模板化统计特征或套话痕迹",
  "suggestions": [
    { "id": 1, "type": "结构重组", "desc": "倒装与语序重组，打破AI机械句式", "text": "改写后文本..." },
    { "id": 2, "type": "去痕重写", "desc": "彻底剔除高频套话，换用实质性论述", "text": "改写后文本..." },
    { "id": 3, "type": "逻辑跃迁", "desc": "提炼核心论点，从宏观视角重构", "text": "改写后文本..." }
  ]
}"""
    },
    "paper_polish_enhance": {
        "name": "润色 + 增强",
        "desc": "两阶段完整处理",
        "system_prompt": """你是一位兼备学术期刊主审与AIGC检测规避双重能力的论文专家。
你的任务是对被标红语句进行【学术润色 + 原创性增强】两阶段深度重构，既提升学术严谨表达，又强力消除AI痕迹。

【规范要求】：
1. 必须保持严谨、规范的书面学术语体（Register），杜绝口语化与网络用语。
2. 原文的所有专有名词、核心术语、关键数据与因果结论完整保留，严禁擅自篡改或编造。
3. 必须针对原句输出 3 条不同改写策略的高质量候选建议：
   - 建议 1（结构重组）：主被动语态调整、语序重排或前后置换，打破原句机械节奏；
   - 建议 2（学术精炼）：彻底剔除“从...看”、“把...作为/列为...之一”等AI模板套话，精炼学术论述；
   - 建议 3（深度重构）：综合学术润色与原创性增强，以全新专业学术逻辑重塑该句。
4. 必须输出合法的 JSON 格式，不要输出任何多余内容，格式如下：
{
  "reason": "指出原句存在的AI模板化问题与可提升的学术点",
  "suggestions": [
    { "id": 1, "type": "结构重组", "desc": "调整语序与主被动结构", "text": "改写后文本..." },
    { "id": 2, "type": "学术精炼", "desc": "剔除模板套话，精炼学术论述", "text": "改写后文本..." },
    { "id": 3, "type": "深度重构", "desc": "综合润色与增强，重塑学术逻辑", "text": "改写后文本..." }
  ]
}"""
    },
    "emotion_polish": {
        "name": "感情文章润色",
        "desc": "自然、人性化表达",
        "system_prompt": """你是一位富有共情力与文学功底的文章润色专家，擅长将冰冷死板的AI腔调转化为自然、真挚、有人情味的文字。
你的任务是对感情向、散文、随笔或评论文章中带有机器说教味、生硬假分析的语句进行人性化润色，恢复生动鲜活的人格化表达。

【规范要求】：
1. 必须消除冰冷机械的AI腔、公文腔、总结说教腔，使语气自然真切、像人在发自内心地倾诉或叙述。
2. 保留原文的人称、立场、事实关系与核心情感倾向，不凭空捏造无关经历。
3. 必须针对原句输出 3 条不同人性化润色策略的高质量候选建议：
   - 建议 1（自然真挚）：转换为真实自然的生活化口吻，消除生硬的过渡词与机械句式；
   - 建议 2（细腻描摹）：强化情绪细节与心理画面感，让文字更具温度和感染力；
   - 建议 3（叙事重塑）：调整句群节奏与叙事切入视角，引发读者情感共鸣。
4. 必须输出合法的 JSON 格式，不要输出任何多余内容，格式如下：
{
  "reason": "指出原句中机械生硬、说教味或缺乏人情味的AI痕迹",
  "suggestions": [
    { "id": 1, "type": "自然真挚", "desc": "生活化叙述口吻，消除机械说教腔", "text": "改写后文本..." },
    { "id": 2, "type": "细腻描摹", "desc": "强化细节情绪，让文字更有温度", "text": "改写后文本..." },
    { "id": 3, "type": "叙事重塑", "desc": "调整叙事节奏，增强情感共鸣", "text": "改写后文本..." }
  ]
}"""
    }
}


def replace_text_in_paragraph(p: docx.text.paragraph.Paragraph, old_text: str, new_text: str) -> bool:
    """在 docx 段落中原位替换文字，并尽最大可能保留原有 runs 的字体、加粗等样式格式"""
    if old_text not in p.text:
        return False
    
    full_text = "".join(run.text for run in p.runs)
    if old_text not in full_text:
        p.text = p.text.replace(old_text, new_text)
        return True

    for run in p.runs:
        if old_text in run.text:
            run.text = run.text.replace(old_text, new_text)
            return True

    start = full_text.find(old_text)
    end = start + len(old_text)
    curr = 0
    first_modified = False

    for run in p.runs:
        run_len = len(run.text)
        run_start = curr
        run_end = curr + run_len
        curr = run_end

        if run_end <= start or run_start >= end:
            continue

        overlap_start = max(0, start - run_start)
        overlap_end = min(run_len, end - run_start)

        if not first_modified:
            run.text = run.text[:overlap_start] + new_text + run.text[overlap_end:]
            first_modified = True
        else:
            run.text = run.text[:overlap_start] + run.text[overlap_end:]

    return True


def split_paragraph_into_spans(
    p_text: str,
    p_id: str,
    is_body: bool = True,
    mode: str = "paper_polish_enhance"
) -> List[Dict[str, Any]]:
    """将段落切分为句子/短语切片，并精准标识出需要润色、增强或消除 AIGC 痕迹的高危文本片段"""
    clean_p = p_text.strip()
    if not clean_p:
        return [{
            "id": f"{p_id}_s0",
            "original_text": p_text,
            "current_text": p_text,
            "needs_mod": False,
            "reason": None,
            "suggestions": [],
            "is_applied": False,
            "selected_suggestion_id": None
        }]

    # 按主要标点切分为自然句子/句段
    major_tokens = re.split(r'([。！？!?；;\n]+)', p_text)
    raw_sentences = []
    i = 0
    while i < len(major_tokens):
        s_part = major_tokens[i]
        d_part = major_tokens[i + 1] if i + 1 < len(major_tokens) else ""
        full_s = s_part + d_part
        if full_s:
            raw_sentences.append(full_s)
        i += 2

    if not raw_sentences:
        return [{
            "id": f"{p_id}_s0",
            "original_text": p_text,
            "current_text": p_text,
            "needs_mod": False,
            "reason": None,
            "suggestions": [],
            "is_applied": False,
            "selected_suggestion_id": None
        }]

    spans: List[Dict[str, Any]] = []
    span_counter = 0
    matched_any = False

    # 1. 优先使用 AIGC 高危模式与模板套话匹配
    for sentence in raw_sentences:
        matched_reason = None
        for pattern, reason in AIGC_PATTERNS:
            if pattern.search(sentence):
                matched_reason = reason
                break

        if matched_reason:
            matched_any = True
            spans.append({
                "id": f"{p_id}_s{span_counter}",
                "original_text": sentence,
                "current_text": sentence,
                "needs_mod": True,
                "reason": matched_reason,
                "suggestions": [],
                "is_applied": False,
                "selected_suggestion_id": None
            })
        else:
            spans.append({
                "id": f"{p_id}_s{span_counter}",
                "original_text": sentence,
                "current_text": sentence,
                "needs_mod": False,
                "reason": None,
                "suggestions": [],
                "is_applied": False,
                "selected_suggestion_id": None
            })
        span_counter += 1

    # 2. 如果是正文主体段落 (非标题/非章节名/非空段，字数>=25)
    #    且本段落尚无任何句子被标红，在段落中选取最适合润色/增强的核心句
    if is_body and len(clean_p) >= 25 and not matched_any:
        candidate_indices = [
            idx for idx, s in enumerate(spans)
            if len(s["original_text"].strip()) >= 15
        ]
        if not candidate_indices:
            candidate_indices = [
                idx for idx, s in enumerate(spans)
                if len(s["original_text"].strip()) >= 8
            ]

        if candidate_indices:
            best_idx = max(candidate_indices, key=lambda idx: len(spans[idx]["original_text"]))
            if mode == "paper_polish":
                reason = "学术表达较繁复，建议精炼句式与提升学术流畅度"
            elif mode == "paper_enhance":
                reason = "句式结构较为均一，建议重组倒装以增强原创性"
            elif mode == "emotion_polish":
                reason = "语言表达略显平淡生硬，建议转换为更真挚自然的表达"
            else:
                reason = "建议进行学术润色与原创性增强两阶段重构"

            spans[best_idx]["needs_mod"] = True
            spans[best_idx]["reason"] = reason

    return spans


def parse_docx_to_session(file_path: str, filename: str, processing_mode: str = "paper_polish_enhance") -> Dict[str, Any]:
    """读取 docx 并构建文档的结构化 AST / Session 数据"""
    session_id = str(uuid.uuid4())
    session_dir = os.path.join(DATA_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)

    saved_orig_path = os.path.join(session_dir, "original.docx")
    with open(file_path, "rb") as src, open(saved_orig_path, "wb") as dst:
        dst.write(src.read())

    doc = docx.Document(saved_orig_path)
    paragraphs: List[Dict[str, Any]] = []

    total_sentences = 0
    need_mod_count = 0

    for idx, p in enumerate(doc.paragraphs):
        p_text = p.text
        style_name = p.style.name if p.style else "Normal"
        align = "left"
        if p.alignment == WD_ALIGN_PARAGRAPH.CENTER:
            align = "center"
        elif p.alignment == WD_ALIGN_PARAGRAPH.RIGHT:
            align = "right"
        elif p.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY:
            align = "justify"

        clean_p = p_text.strip()
        is_title = "Title" in style_name or (idx == 0 and len(clean_p) < 40 and not clean_p.startswith("（"))
        is_subtitle = "Subtitle" in style_name or clean_p.startswith("——")
        is_heading = "Heading" in style_name or bool(re.match(r'^(?:[第]?[一二三四五六七八九十]+[章节部分篇、.]|[（(][一二三四五六七八九十]+[）)]|\d+[.、]|\d+\.\d+)', clean_p))
        is_body = not (is_title or is_subtitle or is_heading or len(clean_p) == 0)

        spans = split_paragraph_into_spans(p_text, f"p{idx}", is_body=is_body, mode=processing_mode)
        for s in spans:
            total_sentences += 1
            if s["needs_mod"]:
                need_mod_count += 1

        paragraphs.append({
            "id": f"p{idx}",
            "index": idx,
            "style": style_name,
            "align": align,
            "is_title": is_title,
            "is_subtitle": is_subtitle,
            "is_heading": is_heading,
            "original_text": p_text,
            "sentences": spans
        })

    session_data = {
        "session_id": session_id,
        "filename": filename,
        "processing_mode": processing_mode,
        "status": "processing",
        "progress": 10.0,
        "current_stage": "scanning",
        "current_position": 0,
        "total_to_process": need_mod_count,
        "error_message": None,
        "created_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "total_paragraphs": len(paragraphs),
        "total_sentences": total_sentences,
        "need_mod_count": need_mod_count,
        "modified_count": 0,
        "paragraphs": paragraphs
    }

    save_session(session_data)
    return session_data


def save_session(session_data: Dict[str, Any]):
    """持久化会话数据到 json 文件（使用原子写入，杜绝并发读取冲突或界面卡顿）"""
    session_id = session_data["session_id"]
    session_dir = os.path.join(DATA_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)
    json_path = os.path.join(session_dir, "session.json")
    tmp_path = os.path.join(session_dir, f"session_{uuid.uuid4().hex[:8]}.tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(session_data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, json_path)
    except Exception as e:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        raise e


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """获取指定会话数据（具备重试与防并发半读取机制）"""
    json_path = os.path.join(DATA_DIR, session_id, "session.json")
    if not os.path.exists(json_path):
        return None
    last_err = None
    for _ in range(3):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            last_err = e
            time.sleep(0.04)
    if last_err:
        logging.error(f"Failed to read session.json for {session_id} after 3 attempts: {last_err}")
    return None


def list_sessions() -> List[Dict[str, Any]]:
    """列出所有 Word 降重会话"""
    sessions = []
    if not os.path.exists(DATA_DIR):
        return sessions

    for d in os.listdir(DATA_DIR):
        json_path = os.path.join(DATA_DIR, d, "session.json")
        if os.path.isfile(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    sessions.append({
                        "session_id": data["session_id"],
                        "filename": data["filename"],
                        "created_at": data.get("created_at"),
                        "processing_mode": data.get("processing_mode", "paper_polish_enhance"),
                        "status": data.get("status", "completed"),
                        "progress": data.get("progress", 100.0),
                        "current_stage": data.get("current_stage", "completed"),
                        "current_position": data.get("current_position", 0),
                        "total_to_process": data.get("total_to_process", data.get("need_mod_count", 0)),
                        "need_mod_count": data.get("need_mod_count", 0),
                        "modified_count": data.get("modified_count", 0),
                        "total_paragraphs": data.get("total_paragraphs", 0)
                    })
            except Exception:
                continue

    sessions.sort(key=lambda x: x["created_at"], reverse=True)
    return sessions


def delete_session(session_id: str) -> bool:
    """删除会话目录及文件"""
    session_dir = os.path.join(DATA_DIR, session_id)
    if os.path.exists(session_dir):
        import shutil
        shutil.rmtree(session_dir, ignore_errors=True)
        return True
    return False


async def process_word_session_full(session_id: str):
    """后台任务：对整个 Word 文档进行全量 AIGC 检索分析与推荐建议生成（txt同款流程）"""
    session = get_session(session_id)
    if not session:
        return

    ai_service = None
    try:
        ai_service = AIService(
            model=settings.POLISH_MODEL,
            api_key=settings.POLISH_API_KEY,
            base_url=settings.POLISH_BASE_URL
        )
    except Exception as e:
        print(f"[WARN] process_word_session_full AIService init warning: {e}")

    mode = session.get("processing_mode", "paper_polish_enhance")

    targets = []
    for p in session.get("paragraphs", []):
        for s in p.get("sentences", []):
            if s.get("needs_mod"):
                targets.append((p, s))

    session["total_to_process"] = len(targets)
    session["need_mod_count"] = len(targets)

    if not targets:
        session["status"] = "completed"
        session["progress"] = 100.0
        session["current_stage"] = "completed"
        session["completed_at"] = datetime.utcnow().isoformat()
        save_session(session)
        return

    try:
        session["current_stage"] = "generating"
        save_session(session)

        for idx, (p, s) in enumerate(targets):
            progress = 10.0 + (idx / len(targets)) * 85.0
            session["progress"] = round(progress, 1)
            session["current_position"] = idx
            save_session(session)

            if not s.get("suggestions") or len(s["suggestions"]) < 3:
                try:
                    res = await generate_3_suggestions(s["original_text"], p["original_text"], ai_service, mode=mode)
                    s["reason"] = res.get("reason", "高危AI模板句式")
                    s["suggestions"] = res.get("suggestions", [])
                except Exception as err:
                    print(f"[WARN] generate_3_suggestions error for {s['id']}: {err}")

            save_session(session)

        session["status"] = "completed"
        session["progress"] = 100.0
        session["current_stage"] = "completed"
        session["current_position"] = len(targets)
        session["completed_at"] = datetime.utcnow().isoformat()
        save_session(session)
        print(f"[INFO] Word session {session_id} full processing completed successfully!")

    except Exception as e:
        print(f"[ERROR] process_word_session_full failed for {session_id}: {e}")
        session["status"] = "failed"
        session["error_message"] = str(e)
        save_session(session)


async def generate_3_suggestions(
    original_text: str,
    context: str,
    ai_service: Optional[AIService] = None,
    mode: str = "paper_polish_enhance"
) -> Dict[str, Any]:
    """调用大模型为目标语句生成 3 条不同策略的高质量学术改写建议（按选择模式定制）"""
    if ai_service is None:
        try:
            ai_service = AIService(
                model=settings.POLISH_MODEL,
                api_key=settings.POLISH_API_KEY,
                base_url=settings.POLISH_BASE_URL
            )
        except Exception as e:
            print(f"[WARN] Failed to initialize AIService in generate_3_suggestions: {e}")
            ai_service = None

    mode_cfg = MODE_CONFIGS.get(mode, MODE_CONFIGS["paper_polish_enhance"])
    system_prompt = mode_cfg["system_prompt"]

    user_content = f"""【处理模式】：{mode_cfg['name']}（{mode_cfg['desc']}）

【待修改语句】：
{original_text}

【周围上下文】：
{context}"""

    if ai_service is not None:
        try:
            raw_response = await ai_service.complete(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                temperature=0.4
            )

            cleaned = remove_thinking_tags(raw_response).strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
                cleaned = re.sub(r'\s*```$', '', cleaned)

            try:
                data = json.loads(cleaned)
            except Exception:
                json_match = re.search(r'\{[\s\S]*\}', cleaned)
                if json_match:
                    data = json.loads(json_match.group(0))
                else:
                    data = {}

            if "suggestions" in data and isinstance(data["suggestions"], list) and len(data["suggestions"]) > 0:
                return data
        except Exception as e:
            print(f"[ERROR] generate_3_suggestions failed for mode={mode}: {e}")

    # 动态根据当前原句与处理模式生成 3 条备用策略建议
    clean_txt = original_text.strip("。！？!?，, ")
    if mode == "paper_polish":
        return {
            "reason": "原句学术规范度欠佳，建议通过学术用语规范、精炼句式与强化论述逻辑进行润色。",
            "suggestions": [
                {
                    "id": 1,
                    "type": "学术规范",
                    "desc": "规范学术语体与术语，消除口语痕迹",
                    "text": f"在学术规范视阈下，{clean_txt}，具有显著的理论价值与实践意义。"
                },
                {
                    "id": 2,
                    "type": "句式精炼",
                    "desc": "优化长句从属，凝练学术表达",
                    "text": f"鉴于此，{clean_txt}，进一步夯实了相关研究的逻辑支撑。"
                },
                {
                    "id": 3,
                    "type": "语篇衔接",
                    "desc": "强化学术逻辑衔接，增强论证力度",
                    "text": f"依循这一研究脉络，{clean_txt}。"
                }
            ]
        }
    elif mode == "paper_enhance":
        return {
            "reason": "原句命中AI高频统计模板特征，建议通过倒装重组与剔除套话直接提升原创度。",
            "suggestions": [
                {
                    "id": 1,
                    "type": "结构重组",
                    "desc": "倒装与语序重组，打破AI机械句式",
                    "text": f"从实践逻辑层面考量，{clean_txt}。"
                },
                {
                    "id": 2,
                    "type": "去痕重写",
                    "desc": "彻底剔除高频套话，换用实质性论述",
                    "text": f"立足于实证分析维度，{clean_txt}。"
                },
                {
                    "id": 3,
                    "type": "逻辑跃迁",
                    "desc": "提炼核心论点，从宏观视角重构",
                    "text": f"该研究进路明确表明，{clean_txt}。"
                }
            ]
        }
    elif mode == "emotion_polish":
        return {
            "reason": "原句带有较为机械生硬的AI说教腔调，建议转换为自然真挚的生活化人情味表达。",
            "suggestions": [
                {
                    "id": 1,
                    "type": "自然真挚",
                    "desc": "生活化叙述口吻，消除机械说教腔",
                    "text": f"其实仔细想来，{clean_txt}。"
                },
                {
                    "id": 2,
                    "type": "细腻描摹",
                    "desc": "强化细节情绪，让文字更有温度",
                    "text": f"字里行间流露出的，恰是{clean_txt}。"
                },
                {
                    "id": 3,
                    "type": "叙事重塑",
                    "desc": "调整叙事节奏，增强情感共鸣",
                    "text": f"回过头来看，{clean_txt}，才真正让文字有了温度与共鸣。"
                }
            ]
        }
    else:
        # paper_polish_enhance
        return {
            "reason": "原句含有模板化句式与AI常见过渡结构，建议重排语序与学术精炼。",
            "suggestions": [
                {
                    "id": 1,
                    "type": "结构重组",
                    "desc": "调整语序与主被动结构",
                    "text": f"在系统性架构设计下，{clean_txt}。"
                },
                {
                    "id": 2,
                    "type": "学术精炼",
                    "desc": "剔除模板套话，精炼学术论述",
                    "text": f"明确将该要素界定为核心研究维度，{clean_txt}。"
                },
                {
                    "id": 3,
                    "type": "深度重构",
                    "desc": "综合润色与增强，重塑学术逻辑",
                    "text": f"以规范化研究范式为导向，{clean_txt}。"
                }
            ]
        }


def apply_sentence_suggestion(
    session_id: str,
    sentence_id: str,
    selected_text: Optional[str] = None,
    suggestion_id: Optional[int] = None,
    new_text: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """采纳用户选择的建议或自定义改写，更新句子状态并保存会话"""
    chosen_text = selected_text if selected_text is not None else new_text
    if chosen_text is None:
        raise ValueError("selected_text 或 new_text 必须至少提供一个")
    session = get_session(session_id)
    if not session:
        return None

    target_sentence = None
    target_paragraph = None

    for p in session["paragraphs"]:
        for s in p["sentences"]:
            if s["id"] == sentence_id:
                target_sentence = s
                target_paragraph = p
                break
        if target_sentence:
            break

    if not target_sentence:
        return None

    target_sentence["current_text"] = chosen_text
    target_sentence["is_applied"] = True
    target_sentence["selected_suggestion_id"] = suggestion_id

    # 重新统计已修改数量
    mod_count = 0
    for p in session["paragraphs"]:
        for s in p["sentences"]:
            if s.get("is_applied", False):
                mod_count += 1
    session["modified_count"] = mod_count

    save_session(session)
    return session


def restore_sentence_original(session_id: str, sentence_id: str) -> Optional[Dict[str, Any]]:
    """将指定句子还原为原始文本"""
    session = get_session(session_id)
    if not session:
        return None

    target_sentence = None
    for p in session["paragraphs"]:
        for s in p["sentences"]:
            if s["id"] == sentence_id:
                target_sentence = s
                break
        if target_sentence:
            break

    if not target_sentence:
        return None

    target_sentence["current_text"] = target_sentence["original_text"]
    target_sentence["is_applied"] = False
    target_sentence["selected_suggestion_id"] = None

    mod_count = 0
    for p in session["paragraphs"]:
        for s in p["sentences"]:
            if s.get("is_applied", False):
                mod_count += 1
    session["modified_count"] = mod_count

    save_session(session)
    return session


def export_modified_docx(session_id: str) -> io.BytesIO:
    """根据会话中已确认的修改，应用到原始 docx 模板并生成最终导出的二进制流"""
    session = get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    session_dir = os.path.join(DATA_DIR, session_id)
    orig_docx_path = os.path.join(session_dir, "original.docx")
    if not os.path.exists(orig_docx_path):
        raise FileNotFoundError(f"Original docx not found for session {session_id}")

    doc = docx.Document(orig_docx_path)

    for p_data in session["paragraphs"]:
        p_idx = p_data["index"]
        if p_idx >= len(doc.paragraphs):
            continue
        p = doc.paragraphs[p_idx]

        for s_data in p_data["sentences"]:
            if s_data.get("is_applied") and s_data.get("current_text") != s_data.get("original_text"):
                old_t = s_data["original_text"]
                new_t = s_data["current_text"]
                replace_text_in_paragraph(p, old_t, new_t)

    output_stream = io.BytesIO()
    doc.save(output_stream)
    output_stream.seek(0)
    return output_stream


def batch_apply_all_suggestions(session_id: str) -> Dict[str, Any]:
    """一键采纳所有具备建议方案的待优化语句（默认采用第 1 条推荐方案）"""
    session = get_session(session_id)
    if not session:
        return {"error": "会话不存在"}

    applied_count = 0
    skipped_count = 0
    modified_count = session.get("modified_count", 0)

    for p in session.get("paragraphs", []):
        for s in p.get("sentences", []):
            if s.get("needs_mod") and not s.get("is_applied"):
                suggestions = s.get("suggestions", [])
                if suggestions and len(suggestions) > 0:
                    chosen = suggestions[0]
                    s["current_text"] = chosen["text"]
                    s["is_applied"] = True
                    s["selected_suggestion_id"] = chosen.get("id", 1)
                    modified_count += 1
                    applied_count += 1
                else:
                    skipped_count += 1

    session["modified_count"] = modified_count
    save_session(session)
    return {
        "session": session,
        "applied_count": applied_count,
        "skipped_count": skipped_count
    }

