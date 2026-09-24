import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Download, CheckCircle, AlertCircle, FileText,
  Sparkles, RefreshCw, Check, Undo2, ChevronRight, ChevronLeft,
  Info, Loader2, Sparkle
} from 'lucide-react';
import { wordOptAPI } from '../api';

const MODE_NAMES = {
  paper_polish: '论文润色',
  paper_enhance: '论文增强',
  paper_polish_enhance: '润色 + 增强',
  emotion_polish: '感情文章润色',
};

const WordSessionDetailPage = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSentenceId, setSelectedSentenceId] = useState(null);
  const [selectedParagraphIndex, setSelectedParagraphIndex] = useState(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [customText, setCustomText] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  const hasAutoSelectedRef = React.useRef(false);
  const docContainerRef = React.useRef(null);

  // 加载会话数据（分离首次加载与静默刷新，杜绝切换选择时销毁挂载导致跳顶）
  const loadSession = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const res = await wordOptAPI.getSession(sessionId);
      setSession(res.data);

      // 仅在首次挂载且未选择句子时，默认选中第一个待修改的句子
      if (!hasAutoSelectedRef.current && res.data?.paragraphs) {
        for (let pIdx = 0; pIdx < res.data.paragraphs.length; pIdx++) {
          const p = res.data.paragraphs[pIdx];
          const firstRed = p.sentences.find(s => s.needs_mod && !s.is_applied);
          if (firstRed) {
            setSelectedSentenceId(firstRed.id);
            setSelectedParagraphIndex(pIdx);
            hasAutoSelectedRef.current = true;
            break;
          }
        }
      }
    } catch (err) {
      console.error('加载 Word 会话失败:', err);
      toast.error('加载文档会话失败');
      navigate('/workspace');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [sessionId, navigate]);

  useEffect(() => {
    loadSession(true);
  }, [loadSession]);

  useEffect(() => {
    if (session?.status === 'processing') {
      const interval = setInterval(() => {
        loadSession(false);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [session?.status, loadSession]);

  // 提取当前选中的句子对象和所在段落
  const selectedSentenceData = useMemo(() => {
    if (!session || !selectedSentenceId) return null;
    for (let pIdx = 0; pIdx < session.paragraphs.length; pIdx++) {
      const p = session.paragraphs[pIdx];
      const s = p.sentences.find(item => item.id === selectedSentenceId);
      if (s) {
        return { sentence: s, paragraph: p, pIndex: pIdx };
      }
    }
    return null;
  }, [session, selectedSentenceId]);

  // 当选中的句子变化时，如果未生成建议则调用生成
  useEffect(() => {
    if (!selectedSentenceData) return;
    const { sentence } = selectedSentenceData;

    setSelectedSuggestionIndex(0);
    setIsCustomMode(false);
    setCustomText('');

    if (sentence.needs_mod && (!sentence.suggestions || sentence.suggestions.length === 0)) {
      handleGenerateSuggestions(sentence.id, false);
    }
  }, [selectedSentenceId]);

  // 调用生成建议
  const handleGenerateSuggestions = async (sentenceId, force = false) => {
    try {
      setIsGenerating(true);
      const res = await wordOptAPI.generateSuggestion(sessionId, sentenceId, force);
      setSession(prev => {
        if (!prev) return prev;
        const newParas = prev.paragraphs.map(p => ({
          ...p,
          sentences: p.sentences.map(s => {
            if (s.id === sentenceId) {
              return {
                ...s,
                reason: res.data.reason,
                suggestions: res.data.suggestions,
              };
            }
            return s;
          })
        }));
        return { ...prev, paragraphs: newParas };
      });
    } catch (err) {
      console.error('生成建议失败:', err);
      toast.error('生成建议失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  // 收集所有需要修改的句子列表（方便上一个/下一个导航）
  const allRedSentences = useMemo(() => {
    if (!session) return [];
    const list = [];
    session.paragraphs.forEach((p, pIdx) => {
      p.sentences.forEach(s => {
        if (s.needs_mod) {
          list.push({ sentence: s, pIndex: pIdx });
        }
      });
    });
    return list;
  }, [session]);

  const currentRedIndex = useMemo(() => {
    if (!selectedSentenceId || allRedSentences.length === 0) return -1;
    return allRedSentences.findIndex(item => item.sentence.id === selectedSentenceId);
  }, [allRedSentences, selectedSentenceId]);

  const handleNext = () => {
    if (currentRedIndex < allRedSentences.length - 1) {
      const next = allRedSentences[currentRedIndex + 1];
      setSelectedSentenceId(next.sentence.id);
      setSelectedParagraphIndex(next.pIndex);
      setTimeout(() => {
        const el = document.getElementById(next.sentence.id);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  };

  const handlePrev = () => {
    if (currentRedIndex > 0) {
      const prev = allRedSentences[currentRedIndex - 1];
      setSelectedSentenceId(prev.sentence.id);
      setSelectedParagraphIndex(prev.pIndex);
      setTimeout(() => {
        const el = document.getElementById(prev.sentence.id);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  };

  // 确认采纳选中的建议
  const handleApply = async () => {
    if (!selectedSentenceData) return;
    const { sentence } = selectedSentenceData;

    let targetText = '';
    let suggestionId = null;

    if (isCustomMode) {
      if (!customText.trim()) {
        toast.error('自定义内容不能为空');
        return;
      }
      targetText = customText.trim();
    } else {
      if (!sentence.suggestions || sentence.suggestions.length === 0) {
        toast.error('暂无可用建议');
        return;
      }
      const chosen = sentence.suggestions[selectedSuggestionIndex];
      targetText = chosen.text;
      suggestionId = chosen.id;
    }

    try {
      setIsApplying(true);
      const res = await wordOptAPI.applySuggestion(sessionId, sentence.id, targetText, suggestionId);
      setSession(res.data);
      toast.success('已确认采纳修改！');

      // 自动导航到下一个待修改红句
      const nextUnapplied = allRedSentences.find(
        (item, idx) => idx > currentRedIndex && !item.sentence.is_applied
      );
      if (nextUnapplied) {
        setSelectedSentenceId(nextUnapplied.sentence.id);
        setSelectedParagraphIndex(nextUnapplied.pIndex);
        setTimeout(() => {
          const el = document.getElementById(nextUnapplied.sentence.id);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
    } catch (err) {
      console.error('采纳失败:', err);
      toast.error('应用修改失败');
    } finally {
      setIsApplying(false);
    }
  };

  // 还原为原句
  const handleRestore = async () => {
    if (!selectedSentenceData) return;
    const { sentence } = selectedSentenceData;

    try {
      setIsApplying(true);
      const res = await wordOptAPI.restoreSentence(sessionId, sentence.id);
      setSession(res.data);
      toast.success('已还原为原文');
    } catch (err) {
      console.error('还原失败:', err);
      toast.error('还原失败');
    } finally {
      setIsApplying(false);
    }
  };

  // 导出 Word
  const handleExportWord = () => {
    const url = wordOptAPI.exportDocxUrl(sessionId);
    const link = document.createElement('a');
    link.href = url;
    link.download = `[已降重]_${session?.filename || 'document.docx'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('正在下载已修改的 Word 文档...');
  };

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-ios-blue animate-spin mx-auto mb-3" />
          <p className="text-gray-600 text-[15px]">正在解析 Word 文档并扫描 AIGC 特征...</p>
        </div>
      </div>
    );
  }

  const modifiedCount = session.modified_count || 0;
  const needModCount = session.need_mod_count || 0;
  const progressPercent = needModCount > 0 ? Math.round((modifiedCount / needModCount) * 100) : 100;

  return (
    <div className="h-screen w-screen bg-[#f3f4f6] flex flex-col overflow-hidden">
      {/* 顶部操作导航栏 */}
      <nav className="bg-white border-b border-gray-200 flex-shrink-0 h-[56px] px-6 flex items-center justify-between shadow-xs z-30">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/workspace')}
            className="flex items-center gap-1.5 text-gray-600 hover:text-black transition-colors px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-[14px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回工作台</span>
          </button>

          <div className="h-4 w-[1px] bg-gray-200" />

          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-ios-blue" />
            <span className="font-semibold text-[15px] text-gray-900 max-w-xs truncate" title={session.filename}>
              {session.filename}
            </span>
          </div>

          {/* 处理模式徽章 */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-ios-blue text-[12px] font-semibold border border-blue-100">
            <Sparkles className="w-3 h-3" />
            <span>{MODE_NAMES[session.processing_mode] || '润色 + 增强'}</span>
          </div>

          {/* 会话状态徽章 */}
          {session.status === 'processing' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-[12px] font-semibold border border-amber-200">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>全量检索中 {(session.progress || 0).toFixed(0)}%</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-semibold border border-emerald-200">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>检索已就绪</span>
            </div>
          )}

          {/* 进度提示徽章 */}
          <div className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full text-[12px]">
            <span className="text-gray-500">降重确认进度:</span>
            <span className="font-semibold text-gray-800">
              {modifiedCount} / {needModCount} 处已确认
            </span>
            <span className="text-ios-blue font-bold">({progressPercent}%)</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportWord}
            className="flex items-center gap-2 bg-ios-blue hover:bg-blue-600 active:scale-[0.98] text-white font-medium py-1.5 px-4 rounded-xl shadow-xs transition-all text-[14px]"
          >
            <Download className="w-4 h-4" />
            导出 Word 文档 (.docx)
          </button>
        </div>
      </nav>

      {/* 处理中顶部横幅通知 */}
      {session.status === 'processing' && (
        <div className="bg-blue-600 text-white flex-shrink-0 px-6 py-2 flex items-center justify-between text-[13px] shadow-xs z-20">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-white flex-shrink-0" />
            <span className="font-medium">
              后台正在对全篇 Word 文档进行全量 AIGC 特征检索与优化建议预生成...
            </span>
            <span className="bg-blue-700/80 px-2 py-0.5 rounded text-[12px] font-mono">
              {(session.progress || 0).toFixed(1)}% (已完成 {session.current_position || 0} / {session.total_to_process || session.need_mod_count || 1} 处)
            </span>
          </div>
          <span className="text-blue-100 text-[12px] hidden md:inline">
            已检索到的待优化句段已标红，可随时点击左侧红句即时查看修改推荐
          </span>
        </div>
      )}

      {/* 主工作区：左侧文档视图 + 右侧建议抽屉 */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* 左侧文档视口 (模拟 A4 排版视图，独立滚动) */}
        <div ref={docContainerRef} className="flex-1 min-h-0 h-full overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto bg-white shadow-md rounded-xl p-12 min-h-[960px] border border-gray-200 text-gray-800">
            {session.paragraphs.map((p, pIdx) => {
              // 标题样式判断
              let pClass = "text-[16px] leading-[1.85] mb-4 text-justify font-sans ";
              if (p.is_title) {
                pClass = "text-[22px] font-bold text-center text-black mb-3 tracking-wide ";
              } else if (p.is_subtitle) {
                pClass = "text-[16px] text-gray-600 text-center mb-6 font-normal ";
              } else if (p.is_heading) {
                pClass = "text-[17px] font-bold text-black mt-5 mb-2 ";
              } else {
                pClass += "indent-8 "; // 中文段落缩进两字符
              }

              return (
                <div key={p.id} className={pClass}>
                  {p.sentences.map((s) => {
                    const isSelected = s.id === selectedSentenceId;
                    const isRed = s.needs_mod && !s.is_applied;
                    const isApplied = s.is_applied;

                    let spanStyle = "transition-all duration-150 rounded px-0.5 ";

                    if (isRed) {
                      // 如图二所示：红色就是有修改的地方
                      spanStyle += "text-[#e53e3e] font-semibold cursor-pointer hover:bg-red-50 hover:underline underline-offset-4 decoration-red-300 ";
                      if (isSelected) {
                        spanStyle += "ring-2 ring-red-400 bg-red-100/90 shadow-xs ";
                      }
                    } else if (isApplied) {
                      // 已采纳修改的句子：绿色微高亮
                      spanStyle += "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-medium cursor-pointer inline-flex items-center gap-0.5 ";
                      if (isSelected) {
                        spanStyle += "ring-2 ring-emerald-400 bg-emerald-100 ";
                      }
                    } else {
                      // 普通文本
                      spanStyle += "text-gray-800 hover:text-black ";
                      if (isSelected) {
                        spanStyle += "bg-blue-50 ring-1 ring-blue-300 ";
                      }
                    }

                    return (
                      <span
                        key={s.id}
                        id={s.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSentenceId(s.id);
                          setSelectedParagraphIndex(pIdx);
                        }}
                        className={spanStyle}
                        title={
                          isRed
                            ? "点击查看 AI 降重建议方案"
                            : isApplied
                            ? "已采纳修改 (点击可重新调整)"
                            : "点击可针对此句进行重构"
                        }
                      >
                        {s.current_text}
                        {isApplied && (
                          <span className="inline-block text-[10px] text-emerald-600 bg-emerald-100/80 px-1 py-0.2 rounded font-normal ml-0.5">
                            已改
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧抽屉面板 (三条建议修改方案与确认，永远固定贴右侧) */}
        <div className="w-[440px] flex-shrink-0 h-full bg-white border-l border-gray-200 flex flex-col shadow-lg z-20 overflow-hidden">
          {/* 面板头部 */}
          <div className="p-4 border-b border-gray-100 flex-shrink-0 flex items-center justify-between bg-gray-50/70">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-ios-blue" />
              <h3 className="font-semibold text-[15px] text-gray-900">
                AI 降重建议
              </h3>
            </div>

            {/* 上一处 / 下一处 快捷翻阅 */}
            {allRedSentences.length > 0 && (
              <div className="flex items-center gap-1.5 text-[12px] text-gray-500">
                <span>
                  {currentRedIndex >= 0 ? currentRedIndex + 1 : 0} / {allRedSentences.length}
                </span>
                <div className="flex items-center bg-gray-200/70 rounded-md p-0.5">
                  <button
                    onClick={handlePrev}
                    disabled={currentRedIndex <= 0}
                    className="p-1 hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                    title="上一处"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={currentRedIndex >= allRedSentences.length - 1}
                    className="p-1 hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                    title="下一处"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 面板主体内容 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 custom-scrollbar">
            {!selectedSentenceData ? (
              <div className="text-center py-16 px-4">
                <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h4 className="font-medium text-[15px] text-gray-800 mb-1">未选中任何句子</h4>
                <p className="text-[13px] text-gray-500 leading-relaxed">
                  请在左侧 Word 文档中点击任意<span className="text-red-500 font-semibold">【红色标出】</span>的语句，右侧将立即显示 3 条针对性的建议修改方案。
                </p>
              </div>
            ) : (
              <>
                {/* 待修改原句卡片 */}
                <div className="bg-red-50/60 border border-red-100 rounded-xl p-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-red-600 bg-red-100/70 px-2 py-0.5 rounded-md uppercase tracking-wider">
                      待修改原句
                    </span>
                    {selectedSentenceData.sentence.reason && (
                      <span className="text-[11px] text-red-500 truncate max-w-[200px]" title={selectedSentenceData.sentence.reason}>
                        {selectedSentenceData.sentence.reason}
                      </span>
                    )}
                  </div>
                  <p className="text-[14px] text-gray-800 leading-relaxed font-medium">
                    {selectedSentenceData.sentence.original_text}
                  </p>
                </div>

                {/* 3 条建议修改方案 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <Sparkle className="w-3.5 h-3.5 text-ios-blue" />
                      <span className="text-[13px] font-bold text-gray-800 tracking-wide">
                        选择修改方案 (三选一)
                      </span>
                    </div>

                    <button
                      onClick={() => handleGenerateSuggestions(selectedSentenceData.sentence.id, true)}
                      disabled={isGenerating}
                      className="flex items-center gap-1 text-[12px] text-ios-blue hover:opacity-80 transition-opacity"
                    >
                      <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
                      <span>换一批</span>
                    </button>
                  </div>

                  {isGenerating ? (
                    <div className="py-10 text-center bg-gray-50 rounded-xl border border-gray-100">
                      <Loader2 className="w-6 h-6 text-ios-blue animate-spin mx-auto mb-2" />
                      <p className="text-[13px] text-gray-500">
                        {session?.processing_mode === 'emotion_polish'
                          ? '正在生成 3 种自然人性化改写方案...'
                          : session?.processing_mode === 'paper_polish'
                          ? '正在生成 3 种专业学术润色方案...'
                          : session?.processing_mode === 'paper_enhance'
                          ? '正在生成 3 种深度原创去痕方案...'
                          : '正在生成 3 种学术改写与增强方案...'}
                      </p>
                    </div>
                  ) : selectedSentenceData.sentence.suggestions && selectedSentenceData.sentence.suggestions.length > 0 ? (
                    <div className="space-y-3">
                      {selectedSentenceData.sentence.suggestions.map((cand, idx) => {
                        const isChosen = !isCustomMode && selectedSuggestionIndex === idx;
                        return (
                          <div
                            key={cand.id || idx}
                            onClick={() => {
                              setSelectedSuggestionIndex(idx);
                              setIsCustomMode(false);
                            }}
                            className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                              isChosen
                                ? 'bg-blue-50/80 border-ios-blue ring-1 ring-ios-blue/30 shadow-xs'
                                : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                isChosen ? 'bg-ios-blue text-white' : 'bg-gray-100 text-gray-600'
                              }`}>
                                方案 {idx + 1} · {cand.type || '重构'}
                              </span>

                              <span className="text-[11px] text-gray-400">
                                {cand.desc || ''}
                              </span>
                            </div>

                            <p className="text-[14px] text-gray-900 leading-relaxed font-normal">
                              {cand.text}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center bg-gray-50 rounded-xl">
                      <p className="text-[13px] text-gray-500 mb-2">未获取到改写建议</p>
                      <button
                        onClick={() => handleGenerateSuggestions(selectedSentenceData.sentence.id)}
                        className="text-[13px] text-ios-blue underline"
                      >
                        点击重新生成
                      </button>
                    </div>
                  )}
                </div>

                {/* 自定义微调折叠输入框 */}
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] text-gray-500">需要手动微调？</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isCustomMode) {
                          const currentCand = selectedSentenceData.sentence.suggestions?.[selectedSuggestionIndex];
                          setCustomText(currentCand?.text || selectedSentenceData.sentence.original_text);
                          setIsCustomMode(true);
                        } else {
                          setIsCustomMode(false);
                        }
                      }}
                      className="text-[12px] text-ios-blue hover:underline"
                    >
                      {isCustomMode ? '取消自定义' : '开启自定义编辑'}
                    </button>
                  </div>

                  {isCustomMode && (
                    <textarea
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      placeholder="在此直接输入或微调修改后的内容..."
                      rows={3}
                      className="w-full text-[14px] p-3 border border-ios-blue/50 rounded-xl focus:ring-2 focus:ring-ios-blue/20 outline-none"
                    />
                  )}
                </div>
              </>
            )}
          </div>

          {/* 面板底部确认与操作栏 */}
          {selectedSentenceData && (
            <div className="p-4 border-t border-gray-100 flex-shrink-0 bg-white space-y-2">
              <button
                onClick={handleApply}
                disabled={isApplying || isGenerating}
                className="w-full flex items-center justify-center gap-2 bg-ios-blue hover:bg-blue-600 active:scale-[0.98] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-xl shadow-xs transition-all text-[15px]"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>正在应用修改...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>确认采纳并替换</span>
                  </>
                )}
              </button>

              {selectedSentenceData.sentence.is_applied && (
                <button
                  onClick={handleRestore}
                  disabled={isApplying}
                  className="w-full flex items-center justify-center gap-1.5 text-gray-500 hover:text-gray-700 py-1.5 text-[13px] hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>还原为原句文本</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WordSessionDetailPage;
