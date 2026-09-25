import React, { useState, useEffect, useCallback, useMemo, useRef, Component } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Download, CheckCircle, AlertCircle, FileText,
  Sparkles, RefreshCw, Check, Undo2, ChevronRight, ChevronLeft,
  Loader2, Sparkle, RotateCcw, Keyboard, CheckCircle2,
  ListChecks, Zap, X
} from 'lucide-react';
import * as docx from 'docx-preview';
import { wordOptAPI } from '../api';

const MODE_NAMES = {
  paper_polish_enhance: '学术改写 + 增强',
  paper_polish: '论文降重润色',
  paper_enhance: '深度降重去痕',
  emotion_polish: '感情文章润色',
};

// 中英文及标点分词器
function tokenizeForDiff(text) {
  if (!text) return [];
  return text.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9]+|[^\s\w\u4e00-\u9fa5]|\s+/g) || [];
}

// 纯前端快速 Token LCS 差量对比算法（带 300 token 熔断保护）
function computeTokenDiff(oldText, newText) {
  if (!oldText || !newText) {
    return [{ type: 'same', text: newText || oldText || '' }];
  }
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  const m = oldTokens.length;
  const n = newTokens.length;

  if (m > 300 || n > 300) {
    return [
      { type: 'removed', text: oldText },
      { type: 'added', text: newText },
    ];
  }

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldTokens[i] === newTokens[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = m, j = n;
  const diffChunks = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      diffChunks.push({ type: 'same', text: oldTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffChunks.push({ type: 'added', text: newTokens[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffChunks.push({ type: 'removed', text: oldTokens[i - 1] });
      i--;
    }
  }
  diffChunks.reverse();

  const merged = [];
  for (const c of diffChunks) {
    if (merged.length > 0 && merged[merged.length - 1].type === c.type) {
      merged[merged.length - 1].text += c.text;
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}

// 安全跨节点文本包裹器（高精度匹配 Word runs 分片文本，优先复用避免全量重建）
function wrapRangeInElement(parentEl, searchText, sentence, onSelect, isSweep = false) {
  // 如果已存在该句子的 mark 标签，直接增量就地更新，杜绝 DOM 重构抖动
  const existingMark = parentEl.querySelector(`[data-sentence-id="${sentence.id}"]`);
  if (existingMark) {
    existingMark.textContent = sentence.current_text || sentence.original_text;
    existingMark.className = sentence.is_applied
      ? 'docx-aigc-mark docx-aigc-applied'
      : 'docx-aigc-mark docx-aigc-need-mod';
    if (isSweep) {
      existingMark.classList.add('docx-aigc-sweep');
      setTimeout(() => existingMark.classList.remove('docx-aigc-sweep'), 1000);
    }
    return true;
  }

  const text = parentEl.textContent || '';
  const startIdx = text.indexOf(searchText);
  if (startIdx === -1) return false;
  const endIdx = startIdx + searchText.length;

  const walker = document.createTreeWalker(parentEl, NodeFilter.SHOW_TEXT, null, false);
  let currentOffset = 0;
  let startNode = null, startOffset = 0;
  let endNode = null, endOffset = 0;

  let node;
  while ((node = walker.nextNode())) {
    const nodeLen = node.nodeValue.length;
    const nextOffset = currentOffset + nodeLen;

    if (!startNode && startIdx >= currentOffset && startIdx < nextOffset) {
      startNode = node;
      startOffset = startIdx - currentOffset;
    }
    if (!endNode && endIdx > currentOffset && endIdx <= nextOffset) {
      endNode = node;
      endOffset = endIdx - currentOffset;
      break;
    }
    currentOffset = nextOffset;
  }

  if (startNode && endNode) {
    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      const mark = document.createElement('mark');
      mark.className = sentence.is_applied
        ? 'docx-aigc-mark docx-aigc-applied'
        : 'docx-aigc-mark docx-aigc-need-mod';
      if (isSweep) {
        mark.classList.add('docx-aigc-sweep');
        setTimeout(() => mark.classList.remove('docx-aigc-sweep'), 1000);
      }
      mark.setAttribute('data-sentence-id', sentence.id);
      mark.title = sentence.is_applied
        ? '已采纳修改 (点击可切换重新采纳)'
        : '待修改标红 (点击查看 3 条 AI 润色建议)';
      mark.onclick = (e) => {
        e.stopPropagation();
        onSelect(sentence.id);
      };

      const contents = range.extractContents();
      mark.appendChild(contents);
      range.insertNode(mark);
      return true;
    } catch (e) {
      console.warn('wrapRangeInElement failed for sentence:', sentence.id, e);
    }
  }
  return false;
}

// 容错错误边界组件：杜绝白屏
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary captured error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full text-center border border-gray-100">
            <div className="w-14 h-14 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">文档预览组件加载异常</h2>
            <p className="text-sm text-gray-500 mb-6">
              遇到意外错误，请尝试刷新页面重试。
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 shadow-sm transition-all"
              >
                刷新重试
              </button>
              <button
                onClick={() => window.location.href = '/workspace'}
                className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-all"
              >
                返回工作台
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const WordSessionDetailPageContent = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  // 基础状态
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // 交互与AI建议状态
  const [selectedSentenceId, setSelectedSentenceId] = useState(null);
  const [selectedParagraphIndex, setSelectedParagraphIndex] = useState(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [customText, setCustomText] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // 进阶效率特性状态
  const [showDiff, setShowDiff] = useState(true); // 词级 Diff 对比高亮开关
  const [autoAdvance, setAutoAdvance] = useState(true); // 采纳后自动下一处
  const [showShortcutsModal, setShowShortcutsModal] = useState(false); // 快捷键说明弹窗
  const [showBatchConfirmModal, setShowBatchConfirmModal] = useState(false); // 一键采纳确认弹窗
  const [mobileTab, setMobileTab] = useState('doc'); // 移动端双视图：'doc' (文档视图) | 'drawer' (AI建议视图)

  // 动画与微动效引用
  const justAppliedIdRef = useRef(null);

  // docx-preview 渲染容器与互斥状态（彻底解决竞态双渲染）
  const docxContainerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [isDocxRendering, setIsDocxRendering] = useState(false);
  const docxRenderedRef = useRef(false);
  const isRenderingRef = useRef(false);
  const hasAutoSelectedRef = useRef(false);

  const selectedSentenceIdRef = useRef(selectedSentenceId);
  useEffect(() => {
    selectedSentenceIdRef.current = selectedSentenceId;
  }, [selectedSentenceId]);

  // 1. 加载会话数据
  const loadSession = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const res = await wordOptAPI.getSession(sessionId);
      const data = res.data;
      setSession(data);

      // 仅在首次挂载且未选择句子时，默认选中第一个待修改的句子
      if (!hasAutoSelectedRef.current && Array.isArray(data?.paragraphs)) {
        for (let pIdx = 0; pIdx < data.paragraphs.length; pIdx++) {
          const p = data.paragraphs[pIdx];
          if (Array.isArray(p?.sentences)) {
            const firstRed = p.sentences.find(s => s && s.needs_mod && !s.is_applied);
            if (firstRed) {
              setSelectedSentenceId(firstRed.id);
              setSelectedParagraphIndex(pIdx);
              hasAutoSelectedRef.current = true;
              break;
            }
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

  // 后台全量分析时轮询更新状态
  useEffect(() => {
    if (session?.status === 'processing') {
      const interval = setInterval(() => {
        loadSession(false);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [session?.status, loadSession]);

  // 2. 收集所有可优化的红句/绿句列表
  const allModSentences = useMemo(() => {
    if (!session || !Array.isArray(session.paragraphs)) return [];
    const list = [];
    session.paragraphs.forEach((p, pIdx) => {
      if (Array.isArray(p?.sentences)) {
        p.sentences.forEach(s => {
          if (s && s.needs_mod) {
            list.push({ sentence: s, pIndex: pIdx });
          }
        });
      }
    });
    return list;
  }, [session]);

  const currentModIndex = useMemo(() => {
    if (!selectedSentenceId || allModSentences.length === 0) return -1;
    return allModSentences.findIndex(item => item.sentence?.id === selectedSentenceId);
  }, [allModSentences, selectedSentenceId]);

  // 提取当前选中的句子数据
  const selectedSentenceData = useMemo(() => {
    if (!session || !selectedSentenceId || !Array.isArray(session.paragraphs)) return null;
    for (let pIdx = 0; pIdx < session.paragraphs.length; pIdx++) {
      const p = session.paragraphs[pIdx];
      if (Array.isArray(p?.sentences)) {
        const s = p.sentences.find(item => item?.id === selectedSentenceId);
        if (s) {
          return { sentence: s, paragraph: p, pIndex: pIdx };
        }
      }
    }
    return null;
  }, [session, selectedSentenceId]);

  // 3. 调用大模型生成 3 条修改建议 (useCallback 化，避免 stale closure)
  const handleGenerateSuggestions = useCallback(async (sentenceId, force = false) => {
    try {
      setIsGenerating(true);
      const res = await wordOptAPI.generateSuggestion(sessionId, sentenceId, force);
      setSession(prev => {
        if (!prev || !Array.isArray(prev.paragraphs)) return prev;
        const newParas = prev.paragraphs.map(p => ({
          ...p,
          sentences: (p.sentences || []).map(s => {
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
  }, [sessionId]);

  // 4. 当选中的句子变化时，同步建议索引与自定义输入
  useEffect(() => {
    if (!selectedSentenceData) return;
    const { sentence } = selectedSentenceData;

    // 默认高亮已采纳的那一条建议（如果有）
    if (sentence.is_applied && Array.isArray(sentence.suggestions)) {
      const appliedIdx = sentence.suggestions.findIndex(
        cand => cand.id === sentence.selected_suggestion_id || cand.text === sentence.current_text
      );
      if (appliedIdx >= 0) {
        setSelectedSuggestionIndex(appliedIdx);
      } else {
        setSelectedSuggestionIndex(0);
      }
    } else {
      setSelectedSuggestionIndex(0);
    }

    setIsCustomMode(false);
    setCustomText('');

    if (sentence.needs_mod && (!sentence.suggestions || sentence.suggestions.length === 0)) {
      handleGenerateSuggestions(sentence.id, false);
    }
  }, [selectedSentenceId, handleGenerateSuggestions]);

  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // 5. 在标准 Word DOM 上高效标注红句与绿句（O(N) 优化，按段落索引精准对位）
  const highlightSentencesInDocxDOM = useCallback((targetSession = null) => {
    const currentSession = targetSession || sessionRef.current || session;
    const container = docxContainerRef.current;
    if (!container || !currentSession || !Array.isArray(currentSession.paragraphs)) return;

    const pElements = Array.from(container.querySelectorAll('p, .docx-standard-doc p'));
    if (pElements.length === 0) return;

    currentSession.paragraphs.forEach(p => {
      if (Array.isArray(p.sentences)) {
        p.sentences.forEach(s => {
          if (s.needs_mod) {
            const keyText = (s.current_text || s.original_text || '').trim();
            if (keyText.length >= 2) {
              const isSweep = justAppliedIdRef.current === s.id;
              let matched = false;

              // 性能跃升：优先根据 p.index 在对应段落 DOM 中匹配
              if (p.index !== undefined && pElements[p.index]) {
                const targetP = pElements[p.index];
                if (targetP.textContent && targetP.textContent.includes(keyText)) {
                  matched = wrapRangeInElement(targetP, keyText, s, (sid) => {
                    setSelectedSentenceId(sid);
                    setMobileTab('drawer');
                  }, isSweep);
                }
              }

              // 若段落偏移，降级遍历所有段落
              if (!matched) {
                for (const pEl of pElements) {
                  if (pEl.textContent && pEl.textContent.includes(keyText)) {
                    const success = wrapRangeInElement(pEl, keyText, s, (sid) => {
                      setSelectedSentenceId(sid);
                      setMobileTab('drawer');
                    }, isSweep);
                    if (success) break;
                  }
                }
              }
            }
          }
        });
      }
    });

    // 重新应用活动句的脉冲高亮样式
    if (selectedSentenceIdRef.current) {
      const activeEl = container.querySelector(`[data-sentence-id="${selectedSentenceIdRef.current}"]`);
      if (activeEl) {
        activeEl.classList.add('docx-aigc-active');
      }
    }
  }, [session]);

  // 同步当前活动句的视觉锚点样式（高亮+光圈+平滑滚动）
  const updateActiveVisualAnchor = useCallback((activeId) => {
    const container = docxContainerRef.current;
    if (!container) return;
    const marks = container.querySelectorAll('.docx-aigc-mark');
    marks.forEach(m => m.classList.remove('docx-aigc-active'));
    if (activeId) {
      const activeEl = container.querySelector(`[data-sentence-id="${activeId}"]`);
      if (activeEl) {
        activeEl.classList.add('docx-aigc-active');
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, []);

  useEffect(() => {
    if (selectedSentenceId) {
      updateActiveVisualAnchor(selectedSentenceId);
    }
  }, [selectedSentenceId, updateActiveVisualAnchor]);

  // 6. docx-preview 高保真渲染器（无损图片渲染，加入严格原子并发互斥守卫）
  const renderDocxDocument = useCallback(async () => {
    if (!docxContainerRef.current || isRenderingRef.current || docxRenderedRef.current) return;
    try {
      isRenderingRef.current = true;
      docxRenderedRef.current = true;
      setIsDocxRendering(true);

      const response = await wordOptAPI.getDocxBlob(sessionId);
      const buffer = response.data;

      docxContainerRef.current.innerHTML = '';

      await docx.renderAsync(buffer, docxContainerRef.current, null, {
        className: 'docx-standard-doc',
        inWrapper: true,
        breakPages: true,
        ignoreHeight: false,
        ignoreWidth: false,
        renderHeaders: true,
        renderFooters: true,
        useBase64URL: true, // 强制提取全部图片为 Base64，彻底保证图片加载显示
      });

      const cur = sessionRef.current;
      if (cur) {
        highlightSentencesInDocxDOM(cur);
      }
    } catch (err) {
      console.error('docx-preview 渲染失败:', err);
      docxRenderedRef.current = false;
      toast.error('Word 格式解析渲染失败');
    } finally {
      isRenderingRef.current = false;
      setIsDocxRendering(false);
    }
  }, [sessionId, highlightSentencesInDocxDOM]);

  useEffect(() => {
    if (!loading && session && !docxRenderedRef.current) {
      renderDocxDocument();
    }
  }, [loading, session, renderDocxDocument]);

  useEffect(() => {
    if (docxRenderedRef.current && session) {
      highlightSentencesInDocxDOM(session);
    }
  }, [session, highlightSentencesInDocxDOM]);

  // 7. 翻阅操作 (Next / Prev)
  const handleNext = useCallback(() => {
    if (currentModIndex < allModSentences.length - 1) {
      const next = allModSentences[currentModIndex + 1];
      setSelectedSentenceId(next.sentence.id);
      setSelectedParagraphIndex(next.pIndex);
    }
  }, [currentModIndex, allModSentences]);

  const handlePrev = useCallback(() => {
    if (currentModIndex > 0) {
      const prev = allModSentences[currentModIndex - 1];
      setSelectedSentenceId(prev.sentence.id);
      setSelectedParagraphIndex(prev.pIndex);
    }
  }, [currentModIndex, allModSentences]);

  // 8. 确认采纳/切换选中的建议修改
  const handleApply = useCallback(async () => {
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
      justAppliedIdRef.current = sentence.id;

      // 实时给对应 DOM mark 加扫光动效并更新文字
      if (docxContainerRef.current) {
        const mark = docxContainerRef.current.querySelector(`[data-sentence-id="${sentence.id}"]`);
        if (mark) {
          mark.textContent = targetText;
          mark.className = 'docx-aigc-mark docx-aigc-applied docx-aigc-active docx-aigc-sweep';
          mark.title = '已采纳修改 (点击可切换重新采纳)';
          setTimeout(() => {
            mark.classList.remove('docx-aigc-sweep');
          }, 1000);
        }
      }

      const res = await wordOptAPI.applySuggestion(sessionId, sentence.id, targetText, suggestionId);
      setSession(res.data);
      toast.success(sentence.is_applied ? '已成功切换采纳方案！' : '已确认接受采纳修改！');

      // 自动跳转至下一处
      if (autoAdvance && currentModIndex < allModSentences.length - 1) {
        setTimeout(() => {
          handleNext();
        }, 320);
      }
    } catch (err) {
      console.error('采纳失败:', err);
      toast.error(err.response?.data?.detail || '应用修改失败');
    } finally {
      setIsApplying(false);
    }
  }, [selectedSentenceData, isCustomMode, customText, selectedSuggestionIndex, sessionId, autoAdvance, currentModIndex, allModSentences.length, handleNext]);

  // 9. 还原为原句文本
  const handleRestore = useCallback(async () => {
    if (!selectedSentenceData) return;
    const { sentence } = selectedSentenceData;

    try {
      setIsApplying(true);
      const res = await wordOptAPI.restoreSentence(sessionId, sentence.id);
      setSession(res.data);
      toast.success('已还原为采纳前原文');

      if (docxContainerRef.current) {
        const mark = docxContainerRef.current.querySelector(`[data-sentence-id="${sentence.id}"]`);
        if (mark) {
          mark.textContent = sentence.original_text;
          mark.className = 'docx-aigc-mark docx-aigc-need-mod docx-aigc-active';
          mark.title = '待修改标红 (点击查看 3 条 AI 润色建议)';
        }
      }
    } catch (err) {
      console.error('还原失败:', err);
      toast.error('还原失败');
    } finally {
      setIsApplying(false);
    }
  }, [selectedSentenceData, sessionId]);

  // 10. 一键采纳全部首选方案（精准反馈采纳数与跳过数）
  const handleBatchApplyAll = async () => {
    try {
      setIsApplying(true);
      const res = await wordOptAPI.batchApplyAll(sessionId);
      const { session: newSession, applied_count, skipped_count } = res.data || {};
      setSession(newSession || res.data);
      if (skipped_count > 0) {
        toast.success(`已为 ${applied_count} 处推荐方案完成采纳（${skipped_count} 处建议生成中跳过）`);
      } else {
        toast.success(`已一键采纳全部 ${applied_count || 0} 处推荐方案！`);
      }
      setShowBatchConfirmModal(false);
    } catch (err) {
      console.error('批量采纳失败:', err);
      toast.error(err.response?.data?.detail || '批量采纳失败');
    } finally {
      setIsApplying(false);
    }
  };

  // 11. 全局键盘快捷键驱动（J/K 翻句，1/2/3 选方案，Enter 采纳，U 还原，R 换一批，C 自定义，Esc 关闭弹窗）
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 弹窗状态下仅响应 Escape 关闭
      if (showShortcutsModal || showBatchConfirmModal) {
        if (e.key === 'Escape') {
          setShowShortcutsModal(false);
          setShowBatchConfirmModal(false);
        }
        return;
      }

      const tag = e.target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === '1') {
        e.preventDefault();
        setSelectedSuggestionIndex(0);
        setIsCustomMode(false);
      } else if (e.key === '2') {
        e.preventDefault();
        if (selectedSentenceData?.sentence?.suggestions?.[1]) {
          setSelectedSuggestionIndex(1);
          setIsCustomMode(false);
        }
      } else if (e.key === '3') {
        e.preventDefault();
        if (selectedSentenceData?.sentence?.suggestions?.[2]) {
          setSelectedSuggestionIndex(2);
          setIsCustomMode(false);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        handleRestore();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (selectedSentenceData) {
          handleGenerateSuggestions(selectedSentenceData.sentence.id, true);
        }
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setIsCustomMode(prev => !prev);
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsModal(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    showShortcutsModal,
    showBatchConfirmModal,
    handleNext,
    handlePrev,
    handleApply,
    handleRestore,
    handleGenerateSuggestions,
    selectedSentenceData
  ]);

  // 12. 导出 Word (.docx)
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

  // 13. 导出修改对照清单 (.md)
  const handleExportComparison = () => {
    if (!session || !Array.isArray(session.paragraphs)) return;

    let content = `# Word 文档降重与优化修改对照清单\n\n`;
    content += `- **文档名称**: ${session.filename || '未命名文档'}\n`;
    content += `- **生成时间**: ${new Date().toLocaleString()}\n`;
    content += `- **处理模式**: ${MODE_NAMES[session.processing_mode] || '润色 + 增强'}\n`;
    content += `- **采纳进度**: 已采纳 ${session.modified_count || 0} / 待优化 ${session.need_mod_count || 0} 处 (${needModCount > 0 ? Math.round(((session.modified_count || 0) / needModCount) * 100) : 100}%)\n\n`;
    content += `---\n\n## 详细修改对照清单\n\n`;

    let count = 0;
    session.paragraphs.forEach(p => {
      if (Array.isArray(p.sentences)) {
        p.sentences.forEach(s => {
          if (s && s.needs_mod) {
            count++;
            const status = s.is_applied ? '✅ 已采纳' : '⏳ 待修改';
            content += `### 第 ${count} 处 [${status}]\n`;
            content += `- **采纳前原文**: ${s.original_text}\n`;
            if (s.is_applied) {
              content += `- **采纳后文本**: ${s.current_text}\n`;
              const origLen = s.original_text.length;
              const newLen = s.current_text.length;
              const diff = newLen - origLen;
              content += `- **字数对比**: ${origLen} 字 → ${newLen} 字 (${diff >= 0 ? `+${diff}` : diff} 字)\n`;
            }
            if (s.reason) {
              content += `- **优化理由**: ${s.reason}\n`;
            }
            if (s.suggestions && s.suggestions.length > 0) {
              content += `- **备选方案**:\n`;
              s.suggestions.forEach((cand, idx) => {
                const isSelected = s.is_applied && (s.selected_suggestion_id === cand.id || s.current_text === cand.text);
                content += `  - 方案 ${idx + 1} (${cand.type || '改写'})${isSelected ? ' 【已采纳】' : ''}: ${cand.text}\n`;
              });
            }
            content += `\n`;
          }
        });
      }
    });

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `[修改对照表]_${session?.filename?.replace(/\.docx$/i, '') || 'document'}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('已导出修改对照清单 (.md)');
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

  // 判断当前选中的建议方案是否已经被采纳
  const isSelectedSuggestionAlreadyApplied = selectedSentenceData?.sentence?.is_applied && (
    !isCustomMode &&
    selectedSentenceData.sentence.suggestions?.[selectedSuggestionIndex] &&
    (selectedSentenceData.sentence.selected_suggestion_id === selectedSentenceData.sentence.suggestions[selectedSuggestionIndex].id ||
     selectedSentenceData.sentence.current_text === selectedSentenceData.sentence.suggestions[selectedSuggestionIndex].text)
  );

  return (
    <div className="h-screen w-screen bg-[#f3f4f6] flex flex-col overflow-hidden">
      {/* 顶部操作导航栏 (iOS Glass 质感风格，完美适配移动端) */}
      <nav className="bg-white/90 backdrop-blur-md border-b border-gray-200/80 flex-shrink-0 h-[50px] sm:h-[56px] px-2 sm:px-6 flex items-center justify-between shadow-xs z-30">
        <div className="flex items-center gap-1 sm:gap-3 min-w-0">
          <button
            onClick={() => navigate('/workspace')}
            className="flex items-center gap-1 text-gray-700 hover:text-black transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-100 text-[13px] sm:text-[14px] flex-shrink-0"
            title="返回工作台"
          >
            <ArrowLeft className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium whitespace-nowrap hidden sm:inline">返回工作台</span>
            <span className="font-medium whitespace-nowrap sm:hidden">工作台</span>
          </button>

          <div className="h-4 w-[1px] bg-gray-200 hidden xs:block flex-shrink-0" />

          <div className="flex items-center gap-1.5 min-w-0 max-w-[100px] xs:max-w-[150px] sm:max-w-xs flex-shrink">
            <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-ios-blue flex-shrink-0" />
            <span className="font-semibold text-[13px] sm:text-[15px] text-gray-900 truncate" title={session.filename}>
              {session.filename}
            </span>
          </div>

          {/* 处理模式徽章 (中大屏展示) */}
          <div className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-ios-blue text-[12px] font-semibold border border-blue-100 flex-shrink-0">
            <Sparkles className="w-3 h-3" />
            <span>{MODE_NAMES[session.processing_mode] || '润色 + 增强'}</span>
          </div>

          {/* 会话状态徽章 (大屏展示) */}
          {session.status === 'processing' ? (
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-[12px] font-semibold border border-amber-200 flex-shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>全量检索中 {Number(session.progress || 0).toFixed(0)}%</span>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-semibold border border-emerald-200 flex-shrink-0">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>检索已就绪</span>
            </div>
          )}

          {/* 进度提示徽章 (超大屏展示) */}
          <div className="hidden xl:flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full text-[12px] flex-shrink-0">
            <span className="text-gray-500">采纳进度:</span>
            <span className="font-semibold text-gray-800">
              {modifiedCount} / {needModCount} 处已采纳
            </span>
            <span className="text-emerald-600 font-bold">({progressPercent}%)</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
          {/* 一键采纳全部首选方案 */}
          <button
            onClick={() => setShowBatchConfirmModal(true)}
            disabled={session.status === 'processing' || modifiedCount >= needModCount || isApplying}
            className="flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 font-medium py-1 px-2 sm:py-1.5 sm:px-3 rounded-lg sm:rounded-xl transition-all text-[12px] sm:text-[13px] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
            title={
              session.status === 'processing'
                ? '后台全量检索与生成建议中，暂不可批量采纳'
                : modifiedCount >= needModCount
                ? '全部待修改句均已完成采纳'
                : '一键将全篇剩余已生成方案的待修改句采纳为方案 1'
            }
          >
            <Zap className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
            <span className="hidden sm:inline">一键采纳全部</span>
            <span className="sm:hidden">一键采纳</span>
          </button>

          {/* 快捷键提示按钮 (大屏展示) */}
          <button
            onClick={() => setShowShortcutsModal(true)}
            className="hidden md:flex p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
            title="查看快捷键指南 (?)"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          {/* 导出修改对照清单 (大屏展示) */}
          <button
            onClick={handleExportComparison}
            className="hidden md:flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-1.5 px-3 rounded-xl transition-all text-[13px] flex-shrink-0"
            title="导出包含原句、改写句、字数变化及优化理由的 Markdown 清单"
          >
            <ListChecks className="w-4 h-4 text-gray-600" />
            <span>导出修改对照</span>
          </button>

          {/* 导出 Word 文档 */}
          <button
            onClick={handleExportWord}
            className="flex items-center gap-1 sm:gap-2 bg-ios-blue hover:bg-blue-600 active:scale-[0.98] text-white font-medium py-1 px-2.5 sm:py-1.5 sm:px-4 rounded-lg sm:rounded-xl shadow-xs transition-all text-[12px] sm:text-[14px] whitespace-nowrap flex-shrink-0"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
            <span className="hidden sm:inline">导出 Word (.docx)</span>
            <span className="sm:hidden">导出</span>
          </button>
        </div>
      </nav>

      {/* 移动端视图切换条 (仅手机/平板 md 以下屏幕显示) */}
      <div className="md:hidden flex items-center bg-gray-100/90 backdrop-blur-sm px-2 py-1.5 border-b border-gray-200/90 gap-2 flex-shrink-0 z-20">
        <button
          onClick={() => setMobileTab('doc')}
          className={`flex-1 py-1 px-3 rounded-lg text-[13px] flex items-center justify-center gap-1.5 font-medium transition-all ${
            mobileTab === 'doc'
              ? 'bg-white text-gray-900 shadow-xs font-semibold'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>文档全文</span>
          <span className="text-[11px] text-gray-400">({modifiedCount}/{needModCount})</span>
        </button>
        <button
          onClick={() => setMobileTab('drawer')}
          className={`flex-1 py-1 px-3 rounded-lg text-[13px] flex items-center justify-center gap-1.5 font-medium transition-all ${
            mobileTab === 'drawer'
              ? 'bg-white text-ios-blue shadow-xs font-semibold'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-ios-blue" />
          <span>AI 建议方案</span>
          {selectedSentenceData && (
            <span className="w-1.5 h-1.5 rounded-full bg-ios-blue" />
          )}
        </button>
      </div>

      {/* 处理中顶部通知横幅 */}
      {session.status === 'processing' && (
        <div className="bg-blue-600 text-white flex-shrink-0 px-6 py-2 flex items-center justify-between text-[13px] shadow-xs z-20">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-white flex-shrink-0" />
            <span className="font-medium">
              后台正在对全篇 Word 文档进行全量 AIGC 特征检索与优化建议预生成...
            </span>
            <span className="bg-blue-700/80 px-2 py-0.5 rounded text-[12px] font-mono">
              {Number(session.progress || 0).toFixed(1)}% (已完成 {session.current_position || 0} / {session.total_to_process || session.need_mod_count || 1} 处)
            </span>
          </div>
          <span className="text-blue-100 text-[12px] hidden md:inline">
            待优化句段已标红，已采纳句段已标绿，按 J/K 可快速翻阅，按 1/2/3 挑选方案
          </span>
        </div>
      )}

      {/* 主工作区：左侧文档视图 + 迷你热力导航轴 + 右侧建议抽屉 */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* 左侧文档工作区 */}
        <div className={`flex-1 min-h-0 h-full relative overflow-hidden bg-[#e5e7eb] ${mobileTab === 'doc' ? 'flex' : 'hidden md:flex'}`}>
          {/* 标准 docx-preview 视图 */}
          <div
            ref={scrollContainerRef}
            className="flex-1 h-full overflow-y-auto p-2 sm:p-6 md:p-8 custom-scrollbar relative"
          >
            {isDocxRendering && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin text-ios-blue mb-2" />
                <p className="text-sm">正在加载高保真 Word 版式与内嵌图片...</p>
              </div>
            )}
            
            {/* 核心挂载点：docx-preview 官方渲染容器 */}
            <div
              ref={docxContainerRef}
              className="docx-viewer-host max-w-4xl mx-auto shadow-xl rounded-lg bg-white"
            />
          </div>

          {/* 迷你热力导航轴 (Vertical Mini-Heatbar) */}
          {allModSentences.length > 0 && (
            <div className="w-7 h-full bg-white/80 backdrop-blur-sm border-l border-gray-200/60 flex flex-col items-center py-3 z-10 select-none shadow-xs">
              <div className="text-[10px] font-bold text-gray-400 mb-2 writing-mode-vertical">
                热力
              </div>
              <div className="flex-1 w-full overflow-y-auto custom-scrollbar flex flex-col items-center gap-1.5 px-1 py-1">
                {allModSentences.map((item, idx) => {
                  const isSelected = item.sentence.id === selectedSentenceId;
                  const isApplied = item.sentence.is_applied;
                  return (
                    <button
                      key={item.sentence.id}
                      onClick={() => {
                        setSelectedSentenceId(item.sentence.id);
                        setSelectedParagraphIndex(item.pIndex);
                        setMobileTab('drawer');
                      }}
                      title={`第 ${idx + 1} 处 [${isApplied ? '已采纳' : '待修改'}]: ${item.sentence.original_text.slice(0, 30)}...`}
                      className={`w-3 h-3 rounded-full flex items-center justify-center transition-all ${
                        isSelected
                          ? 'scale-125 ring-2 ring-blue-500 ring-offset-1 z-10'
                          : 'hover:scale-125'
                      } ${
                        isApplied
                          ? 'bg-emerald-500 hover:bg-emerald-600'
                          : 'bg-rose-400 hover:bg-rose-500'
                      }`}
                    >
                      {isSelected && <div className="w-1 h-1 bg-white rounded-full" />}
                    </button>
                  );
                })}
              </div>
              <div className="text-[10px] text-gray-400 mt-2 font-mono">
                {modifiedCount}/{allModSentences.length}
              </div>
            </div>
          )}
        </div>

        {/* 右侧抽屉面板 (三条建议修改方案与确认，支持手机端全屏查看) */}
        <div className={`w-full md:w-[450px] flex-shrink-0 h-full bg-white/95 backdrop-blur-md border-l border-gray-200/90 flex flex-col shadow-lg z-20 overflow-hidden ${mobileTab === 'drawer' ? 'flex' : 'hidden md:flex'}`}>
          {/* 面板头部 */}
          <div className="p-3 sm:p-4 border-b border-gray-100 flex-shrink-0 flex items-center justify-between bg-gray-50/80">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMobileTab('doc')}
                className="md:hidden flex items-center gap-0.5 text-[12px] text-gray-600 hover:text-gray-900 bg-white border border-gray-200 px-2 py-1 rounded-md shadow-xs active:bg-gray-100 mr-1"
                title="返回文档"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>看文档</span>
              </button>
              <Sparkles className="w-4 h-4 text-ios-blue" />
              <h3 className="font-semibold text-[14px] sm:text-[15px] text-gray-900">
                AI 降重建议
              </h3>
            </div>

            {/* 上一处 / 下一处 快捷翻阅 */}
            {allModSentences.length > 0 && (
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                <span>
                  {currentModIndex >= 0 ? currentModIndex + 1 : 0} / {allModSentences.length}
                </span>
                <div className="flex items-center bg-gray-200/70 rounded-md p-0.5">
                  <button
                    onClick={handlePrev}
                    disabled={currentModIndex <= 0}
                    className="p-1 hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                    title="上一处 (K)"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={currentModIndex >= allModSentences.length - 1}
                    className="p-1 hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                    title="下一处 (J)"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 面板主体内容 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 custom-scrollbar">
            {!selectedSentenceData ? (
              <div className="text-center py-16 px-4">
                <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h4 className="font-medium text-[15px] text-gray-800 mb-1">未选中任何句子</h4>
                <p className="text-[13px] text-gray-500 leading-relaxed">
                  请在左侧 Word 文档中点击任意<span className="text-red-500 font-semibold">【红色待改】</span>或<span className="text-emerald-600 font-semibold">【绿色已采纳】</span>的语句，右侧将立即显示建议修改方案与切换选项。
                </p>
              </div>
            ) : (
              <>
                {/* 采纳前原文 (原始待优化内容) */}
                <div className="bg-red-50/60 border border-red-100 rounded-xl p-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-red-600 bg-red-100/70 px-2 py-0.5 rounded-md uppercase tracking-wider">
                      采纳前原文（待优化句）
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

                {/* 如果已经采纳，显示当前已生效的修改内容对比卡片 */}
                {selectedSentenceData.sentence.is_applied && (
                  <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3.5 animate-fade-in-up">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        当前已采纳内容
                      </span>
                      <span className="text-[11px] text-emerald-600 font-medium">
                        文档中已标绿生效
                      </span>
                    </div>
                    <p className="text-[14px] text-emerald-900 leading-relaxed font-medium">
                      {selectedSentenceData.sentence.current_text}
                    </p>
                  </div>
                )}

                {/* 3 条建议修改方案 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <Sparkle className="w-3.5 h-3.5 text-ios-blue" />
                      <span className="text-[13px] font-bold text-gray-800 tracking-wide">
                        {selectedSentenceData.sentence.is_applied
                          ? '切换修改方案 (点击重新采纳)'
                          : '选择修改方案 (三选一)'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Diff 对比开关 */}
                      <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={showDiff}
                          onChange={(e) => setShowDiff(e.target.checked)}
                          className="rounded text-ios-blue focus:ring-0 w-3 h-3"
                        />
                        <span>词级对比</span>
                      </label>

                      {/* 换一批 */}
                      <button
                        onClick={() => handleGenerateSuggestions(selectedSentenceData.sentence.id, true)}
                        disabled={isGenerating}
                        className="flex items-center gap-1 text-[12px] text-ios-blue hover:opacity-80 transition-opacity"
                        title="重新生成 3 条修改方案 (快捷键 R)"
                      >
                        <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
                        <span>换一批</span>
                      </button>
                    </div>
                  </div>

                  {isGenerating ? (
                    <div className="py-10 text-center bg-gray-50 rounded-xl border border-gray-100">
                      <Loader2 className="w-6 h-6 text-ios-blue animate-spin mx-auto mb-2" />
                      <p className="text-[13px] text-gray-500">
                        正在基于学术语料库生成 3 组优质改写方案...
                      </p>
                    </div>
                  ) : selectedSentenceData.sentence.suggestions && selectedSentenceData.sentence.suggestions.length > 0 ? (
                    <div className="space-y-3">
                      {selectedSentenceData.sentence.suggestions.map((cand, idx) => {
                        const isChosen = !isCustomMode && selectedSuggestionIndex === idx;
                        const isThisCandApplied = selectedSentenceData.sentence.is_applied && (
                          selectedSentenceData.sentence.selected_suggestion_id === cand.id ||
                          selectedSentenceData.sentence.current_text === cand.text
                        );

                        const origLen = selectedSentenceData.sentence.original_text.length;
                        const candLen = cand.text.length;
                        const delta = candLen - origLen;

                        return (
                          <div
                            key={cand.id || idx}
                            data-testid={`suggestion-card-${idx}`}
                            onClick={() => {
                              setSelectedSuggestionIndex(idx);
                              setIsCustomMode(false);
                            }}
                            className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                              isThisCandApplied
                                ? 'bg-emerald-50/50 border-emerald-500 ring-2 ring-emerald-300/60 shadow-xs'
                                : isChosen
                                ? 'bg-blue-50/80 border-ios-blue ring-2 ring-ios-blue/30 shadow-xs'
                                : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                  isThisCandApplied
                                    ? 'bg-emerald-600 text-white'
                                    : isChosen
                                    ? 'bg-ios-blue text-white'
                                    : 'bg-gray-100 text-gray-600'
                                }`}>
                                  方案 {idx + 1} · {cand.type || '重构'}
                                </span>

                                {isThisCandApplied && (
                                  <span className="flex items-center gap-0.5 text-[11px] font-bold text-emerald-700 bg-emerald-100/90 px-2 py-0.5 rounded-md">
                                    <Check className="w-3 h-3 stroke-[3]" />
                                    已采纳
                                  </span>
                                )}
                              </div>

                              {/* 字数增减差量 Badge */}
                              <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                                delta < 0
                                  ? 'bg-emerald-50 text-emerald-700 font-semibold'
                                  : delta > 0
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}>
                                原{origLen}字 → 现{candLen}字 ({delta >= 0 ? `+${delta}` : delta})
                              </span>
                            </div>

                            {/* 方案内容展示（支持词级 Diff 高亮对比） */}
                            {showDiff ? (
                              <p className="text-[14px] leading-relaxed">
                                {computeTokenDiff(selectedSentenceData.sentence.original_text, cand.text).map((chunk, cIdx) => {
                                  if (chunk.type === 'removed') {
                                    return <span key={cIdx} className="diff-removed">{chunk.text}</span>;
                                  }
                                  if (chunk.type === 'added') {
                                    return <span key={cIdx} className="diff-added">{chunk.text}</span>;
                                  }
                                  return <span key={cIdx} className="diff-same">{chunk.text}</span>;
                                })}
                              </p>
                            ) : (
                              <p className={`text-[14px] leading-relaxed font-normal ${
                                isThisCandApplied ? 'text-emerald-950 font-medium' : 'text-gray-900'
                              }`}>
                                {cand.text}
                              </p>
                            )}
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

                {/* 自定义微调输入框 */}
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] text-gray-500">需要手动微调？(快捷键 C)</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isCustomMode) {
                          const currentCand = selectedSentenceData.sentence.suggestions?.[selectedSuggestionIndex];
                          setCustomText(currentCand?.text || selectedSentenceData.sentence.current_text || selectedSentenceData.sentence.original_text);
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
            <div className="p-4 border-t border-gray-100 flex-shrink-0 bg-white space-y-2.5">
              {/* 采纳后自动下一处开关 */}
              <div className="flex items-center justify-between px-1">
                <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                    className="rounded text-ios-blue focus:ring-0 w-3.5 h-3.5"
                  />
                  <span>采纳后自动跳至下一处</span>
                </label>
                <span className="text-[11px] text-gray-400">快捷键: Enter 采纳</span>
              </div>

              {/* 采纳按钮 */}
              <button
                data-testid="apply-suggestion-btn"
                onClick={handleApply}
                disabled={isApplying || isGenerating || isSelectedSuggestionAlreadyApplied}
                className={`w-full flex items-center justify-center gap-2 font-semibold py-2.5 rounded-xl shadow-xs transition-all text-[15px] ${
                  isSelectedSuggestionAlreadyApplied
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                    : selectedSentenceData.sentence.is_applied
                    ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white'
                    : 'bg-ios-blue hover:bg-blue-600 active:scale-[0.98] text-white'
                } disabled:opacity-80 disabled:cursor-not-allowed`}
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>正在应用修改...</span>
                  </>
                ) : isSelectedSuggestionAlreadyApplied ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>当前方案已在文档中生效</span>
                  </>
                ) : selectedSentenceData.sentence.is_applied ? (
                  <>
                    <RotateCcw className="w-4 h-4 stroke-[2.5]" />
                    <span>切换并重新采纳此方案 (Enter)</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>确认接受并采纳 (Enter)</span>
                  </>
                )}
              </button>

              {/* 还原按钮 */}
              {selectedSentenceData.sentence.is_applied && (
                <button
                  onClick={handleRestore}
                  disabled={isApplying}
                  className="w-full flex items-center justify-center gap-1.5 text-gray-500 hover:text-red-600 py-1.5 text-[13px] hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>还原为采纳前原文 (快捷键 U)</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 快捷键帮助弹窗 Modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-100 animate-fade-in-up">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <div className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-ios-blue" />
                <h3 className="font-bold text-gray-900 text-[16px]">高效键盘快捷键</h3>
              </div>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-[13px]">
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-600">下一处待优化句</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">J</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-600">上一处待优化句</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">K</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-600">选择方案 1 / 2 / 3</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">1 / 2 / 3</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-600">确认采纳 / 切换采纳方案</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">Enter</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-600">还原为采纳前原文</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">U</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-600">重新生成 / 换一批方案</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">R</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-600">切换自定义编辑</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">C</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-600">关闭当前弹窗</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">Esc</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-gray-600">显示/关闭此快捷键帮助</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-mono font-bold">?</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium text-[13px] transition-colors"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一键采纳全部确认弹窗 Modal */}
      {showBatchConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-100 animate-fade-in-up">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Zap className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-gray-900 text-center mb-2">
              一键采纳全部首选方案？
            </h3>

            <p className="text-[13px] text-gray-600 text-center leading-relaxed mb-6">
              将为文档中剩余 <strong>{needModCount - modifiedCount}</strong> 处未处理且已生成建议的待改句段统一采纳<strong>方案 1</strong> 并实时写入 Word 文档。
              <br />
              采纳后您仍可随时点击任意已采纳语句进行切换或撤销还原。
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowBatchConfirmModal(false)}
                disabled={isApplying}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-[14px] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleBatchApplyAll}
                disabled={isApplying}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl text-[14px] shadow-sm transition-colors flex items-center justify-center gap-1.5"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>采纳中...</span>
                  </>
                ) : (
                  <span>确认全量采纳</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const WordSessionDetailPage = () => {
  return (
    <ErrorBoundary>
      <WordSessionDetailPageContent />
    </ErrorBoundary>
  );
};

export default WordSessionDetailPage;
