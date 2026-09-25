import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FileText, History, LogOut, Play,
  Users, Clock, AlertCircle, CheckCircle, Trash2, Info,
  Upload, FileUp, Loader2, Sparkles, ChevronRight, X
} from 'lucide-react';
import { optimizationAPI, wordOptAPI } from '../api';

// 各模式原理与详细配置
const MODES_CONFIG = [
  {
    id: 'paper_polish',
    title: '论文润色',
    desc: '提升学术表达质量',
    badge: '学术规范',
    principleTitle: '规范学术语体 & 修复语病逻辑',
    principleSummary: '严格遵循高水平学术期刊语体规范（Register），修正长从句从属关系混乱、语病与口语化痕迹；优化语篇论证推导节奏，增强学术说服力。',
    mechanism: '基于学术期刊规范 Prompt 约束，重点检测并修正口语化词汇、繁复多余从句与动宾失配，保留专有名词与数据。',
    tags: ['规范术语', '精炼长句', '语篇衔接']
  },
  {
    id: 'paper_enhance',
    title: '论文增强',
    desc: '直接提升原创性',
    badge: '深度去AI',
    principleTitle: '瓦解大模型统计特征 & 倒装重组',
    principleSummary: '深度对抗知网 3.0 / 万方 / PaperPass 等大模型检测算法。重组主被动语序与倒装结构，彻底剔除高频 AI 八股套话，大幅提升困惑度 (PPL) 与突发度 (Burstiness)。',
    mechanism: '通过 8 大类 50+ 种高危 AI 统计模板库识别特征语句，利用句式倒装、语段重塑与实质性论证替换空洞套话，彻底打破大模型平滑概率。',
    tags: ['结构重组', '剔除套话', '打破平滑PPL']
  },
  {
    id: 'paper_polish_enhance',
    title: '润色 + 增强',
    desc: '两阶段完整处理 (推荐)',
    badge: '全能首选',
    principleTitle: '两阶段流水线：先破特征再提质',
    principleSummary: '【两阶段全能流水线】Phase 1 强力瓦解 AI 统计模板与重复模式，打破概率平滑性；Phase 2 进行学术级语篇精炼与逻辑缝合。兼具极低 AIGC 疑似度与极高的学术严谨性。',
    mechanism: '结合了论文增强的降 AIGC 能力与论文润色的学术严谨性，先破坏检测器特征，再保证学术期刊级别的语法和行文流畅度，综合效果最佳。',
    tags: ['两阶段处理', '极低AIGC', '高学术水准']
  },
  {
    id: 'emotion_polish',
    title: '感情文章润色',
    desc: '自然、人性化表达',
    badge: '生活人情味',
    principleTitle: '消除机械说教 & 恢复真挚情感',
    principleSummary: '专为散文、随笔、公文与情感文章打造。彻底消除 AI 大模型自带的冰冷总结癖、机械分析与高高在上的说教味，转换为真实自然、富有生活烟火气与共情力的人格化叙事口吻。',
    mechanism: '约束大模型使用生活化口吻，注入心理画面感与细节情绪描摹，消除机械的“综上所述”、“我们应该”等说教句式，恢复鲜活真挚的人性化表达。',
    tags: ['消除说教', '生活化叙述', '情感共鸣']
  }
];

const MODE_NAMES = {
  paper_polish: '论文润色',
  paper_enhance: '论文增强',
  paper_polish_enhance: '润色 + 增强',
  emotion_polish: '感情文章润色',
};

const WordSessionItem = memo(({ session, onView, onDelete }) => {
  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    onDelete(session);
  }, [session, onDelete]);

  const handleView = useCallback(() => {
    onView(session.session_id);
  }, [session.session_id, onView]);

  return (
    <div
      onClick={handleView}
      className="group p-3 rounded-xl hover:bg-gray-50 transition-all cursor-pointer border border-gray-100 hover:border-gray-200 relative bg-white shadow-xs"
    >
      <div className="flex items-start justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileText className="w-4 h-4 text-ios-blue flex-shrink-0" />
          <span className="text-[13px] font-semibold text-black truncate" title={session.filename}>
            {session.filename}
          </span>
        </div>
        <span className="text-[11px] text-ios-gray/70 font-medium flex-shrink-0">
          {new Date(session.created_at).toLocaleDateString()}
        </span>
      </div>

      <div className="flex items-center justify-between mt-2 pt-1 text-[12px] text-gray-500">
        <div className="flex items-center gap-1.5">
          {session.status === 'processing' ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-ios-blue font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-ios-blue animate-pulse" />
              处理中 {(session.progress || 0).toFixed(0)}%
            </span>
          ) : (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-ios-blue font-medium">
              {MODE_NAMES[session.processing_mode] || '润色 + 增强'}
            </span>
          )}
          <span>
            {session.status === 'processing' ? (
              <span className="text-gray-400">正在检索生成...</span>
            ) : (
              <>已改: <strong className="text-emerald-600 font-bold">{session.modified_count || 0}</strong> / {session.need_mod_count || 0}</>
            )}
          </span>
        </div>
        <button
          onClick={handleDelete}
          className="p-1 text-gray-300 hover:text-ios-red hover:bg-red-50 rounded transition-colors"
          title="删除会话"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});

WordSessionItem.displayName = 'WordSessionItem';

// 会话列表项组件 - 使用 memo 避免不必要重渲染
const SessionItem = memo(({ session, activeSession, onView, onDelete, onRetry }) => {
  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    onDelete(session);
  }, [session, onDelete]);

  const handleRetry = useCallback((e) => {
    e.stopPropagation();
    if (session.status === 'failed') {
      onRetry(session);
    }
  }, [session, onRetry]);

  const handleView = useCallback(() => {
    onView(session.session_id);
  }, [session.session_id, onView]);

  return (
    <div
      onClick={handleView}
      className="group p-3 rounded-xl hover:bg-gray-50 transition-all cursor-pointer border border-transparent hover:border-gray-100 relative"
    >
      <div className="flex items-start justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-1.5">
          {session.status === 'completed' && (
            <CheckCircle className="w-4 h-4 text-ios-green" />
          )}
          {session.status === 'processing' && (
            <div className="w-4 h-4 border-2 border-ios-blue border-t-transparent rounded-full animate-spin" />
          )}
          {session.status === 'failed' && (
            <AlertCircle className="w-4 h-4 text-ios-red" />
          )}
          {session.status === 'stopped' && (
            <AlertCircle className="w-4 h-4 text-orange-500" />
          )}
          <span className={`text-[13px] font-medium ${
            session.status === 'completed' ? 'text-black' :
            session.status === 'processing' ? 'text-ios-blue' :
            session.status === 'failed' ? 'text-ios-red' :
            session.status === 'stopped' ? 'text-orange-600' : 'text-ios-gray'
          }`}>
            {session.status === 'completed' && '已完成'}
            {session.status === 'processing' && '处理中'}
            {session.status === 'queued' && '排队中'}
            {session.status === 'failed' && '失败'}
            {session.status === 'stopped' && '已停止'}
          </span>
        </div>

        <span className="text-[11px] text-ios-gray/70 font-medium">
          {new Date(session.created_at).toLocaleDateString()}
        </span>
      </div>

      <p className="text-[13px] text-ios-gray leading-snug line-clamp-2 mb-2 pr-6">
        {session.preview_text || '暂无预览'}
      </p>

      {session.status === 'processing' && (
        <div className="w-full bg-gray-100 rounded-full h-1 mb-1">
          <div
            className="bg-ios-blue h-1 rounded-full"
            style={{ width: `${session.progress}%` }}
          />
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center justify-between mt-1">
        {session.status === 'failed' && (
          <button
            onClick={handleRetry}
            className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
          >
            继续处理
          </button>
        )}
        <button
          onClick={handleDelete}
          className="p-1.5 text-gray-300 hover:text-ios-red hover:bg-red-50 rounded-lg transition-colors ml-auto"
          title="删除会话"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {session.status === 'failed' && session.current_position < session.total_segments && (
        <div className="text-[11px] text-ios-red bg-red-50 px-2 py-1 rounded mt-1">
          {session.error_message ? '发生错误' : '网络超时'}
        </div>
      )}
    </div>
  );
});

SessionItem.displayName = 'SessionItem';

const WorkspacePage = () => {
  const [taskTab, setTaskTab] = useState('word'); // 'text' | 'word' - 默认进入 Word 全文处理
  const [text, setText] = useState('');
  const [processingMode, setProcessingMode] = useState('paper_polish_enhance');
  const [sessions, setSessions] = useState([]);
  const [wordSessions, setWordSessions] = useState([]);
  const [queueStatus, setQueueStatus] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [activeWordSession, setActiveWordSession] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingWordSessions, setIsLoadingWordSessions] = useState(false);
  const [isUploadingWord, setIsUploadingWord] = useState(false);
  const [showPrincipleModal, setShowPrincipleModal] = useState(null); // null | 'overview' | 'paper_polish' | 'paper_enhance' | 'paper_polish_enhance' | 'emotion_polish'
  const navigate = useNavigate();

  // 加载 Word 会话列表
  const loadWordSessions = useCallback(async () => {
    try {
      setIsLoadingWordSessions(true);
      const res = await wordOptAPI.listSessions();
      const list = res.data || [];
      setWordSessions(list);

      const processing = list.find(s => s.status === 'processing');
      if (processing) {
        setActiveWordSession(processing.session_id);
      }
    } catch (err) {
      console.error('加载 Word 会话列表失败:', err);
    } finally {
      setIsLoadingWordSessions(false);
    }
  }, []);

  const handleUploadWordFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      toast.error('请上传 .docx 格式的 Word 文档');
      return;
    }

    try {
      setIsUploadingWord(true);
      toast.loading('正在上传并加载 Word 在线文档...', { id: 'word-upload' });
      const res = await wordOptAPI.uploadDocx(file, processingMode);
      setActiveWordSession(res.data.session_id);
      toast.success('上传成功，正在进入在线文档...', { id: 'word-upload' });
      // 核心修复过度问题：上传成功后立即平滑跳转进入在线文档页面，避免在工作台界面假死或卡住
      navigate(`/word-session/${res.data.session_id}`);
    } catch (err) {
      console.error('Word 上传解析失败:', err);
      toast.error(err.response?.data?.detail || 'Word 文档解析失败', { id: 'word-upload' });
    } finally {
      setIsUploadingWord(false);
    }
  };

  const handleDeleteWordSession = useCallback(async (session) => {
    if (!window.confirm(`确定删除文档 "${session.filename}" 的降重记录吗？`)) return;
    try {
      await wordOptAPI.deleteSession(session.session_id);
      toast.success('已删除记录');
      loadWordSessions();
    } catch (err) {
      toast.error('删除失败');
    }
  }, [loadWordSessions]);

  const handleViewWordSession = useCallback((sessionId) => {
    navigate(`/word-session/${sessionId}`);
  }, [navigate]);

  // 使用 useCallback 优化函数引用稳定性
  const loadSessions = useCallback(async () => {
    try {
      setIsLoadingSessions(true);
      const response = await optimizationAPI.listSessions();
      setSessions(response.data);

      // 查找正在处理的会话
      const processing = response.data.find(
        s => s.status === 'processing' || s.status === 'queued'
      );
      if (processing) {
        setActiveSession(processing.session_id);
      }
    } catch (error) {
      console.error('加载会话失败:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  // loadQueueStatus 不依赖 activeSession，避免 useEffect 重复触发
  const loadQueueStatus = useCallback(async () => {
    try {
      const response = await optimizationAPI.getQueueStatus();
      setQueueStatus(response.data);
    } catch (error) {
      console.error('加载队列状态失败:', error);
    }
  }, []);

  const updateSessionProgress = useCallback(async (sessionId) => {
    try {
      const response = await optimizationAPI.getSessionProgress(sessionId);
      const progress = response.data;

      // 更新会话列表中的进度 - 只在数据有变化时更新
      setSessions(prev => {
        const target = prev.find(s => s.session_id === sessionId);
        if (target && target.progress === progress.progress && target.status === progress.status) {
          return prev; // 无变化，不触发重渲染
        }
        return prev.map(s =>
          s.session_id === sessionId ? { ...s, ...progress } : s
        );
      });

      // 如果会话完成,刷新列表
      if (progress.status === 'completed' || progress.status === 'failed') {
        setActiveSession(null);
        loadSessions();

        if (progress.status === 'completed') {
          toast.success('优化完成!');
        } else {
          toast.error(`优化失败: ${progress.error_message}`);
        }
      }
    } catch (error) {
      console.error('更新进度失败:', error);
    }
  }, [loadSessions]);

  const updateWordSessionProgress = useCallback(async (sessionId) => {
    try {
      const response = await wordOptAPI.getSessionProgress(sessionId);
      const progress = response.data;

      setWordSessions(prev => {
        const target = prev.find(s => s.session_id === sessionId);
        if (target && target.progress === progress.progress && target.status === progress.status) {
          return prev;
        }
        return prev.map(s =>
          s.session_id === sessionId ? { ...s, ...progress } : s
        );
      });

      if (progress.status === 'completed' || progress.status === 'failed') {
        setActiveWordSession(null);
        loadWordSessions();

        if (progress.status === 'completed') {
          toast.success(`Word 文档 "${progress.filename}" 全量检索与优化已完成！`);
        } else {
          toast.error(`Word 优化失败: ${progress.error_message}`);
        }
      }
    } catch (error) {
      console.error('更新 Word 进度失败:', error);
    }
  }, [loadWordSessions]);

  // 初始加载 - 只在组件挂载时执行一次
  useEffect(() => {
    loadSessions();
    loadWordSessions();
    loadQueueStatus();
  }, [loadSessions, loadWordSessions, loadQueueStatus]);

  // 队列状态轮询 - 独立的 useEffect，避免与初始加载混淆
  useEffect(() => {
    const interval = setInterval(loadQueueStatus, 15000);
    return () => clearInterval(interval);
  }, [loadQueueStatus]);

  useEffect(() => {
    // 如果有活跃会话,每4秒更新进度（进一步降低频率）
    if (activeSession) {
      const interval = setInterval(() => {
        updateSessionProgress(activeSession);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [activeSession, updateSessionProgress]);

  useEffect(() => {
    // 活跃 Word 会话进度轮询
    if (activeWordSession) {
      const interval = setInterval(() => {
        updateWordSessionProgress(activeWordSession);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeWordSession, updateWordSessionProgress]);

  const handleStartOptimization = useCallback(async () => {
    if (!text.trim()) {
      toast.error('请输入要优化的文本');
      return;
    }

    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await optimizationAPI.startOptimization({
        original_text: text,
        processing_mode: processingMode,
      });

      setActiveSession(response.data.session_id);
      toast.success('优化任务已启动');
      setText('');
      loadSessions();
    } catch (error) {
      toast.error('启动优化失败: ' + error.response?.data?.detail);
    } finally {
      setIsSubmitting(false);
    }
  }, [text, processingMode, isSubmitting, loadSessions]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('cardKey');
    navigate('/');
  }, [navigate]);

  const handleDeleteSession = useCallback(async (session) => {
    const confirmDelete = window.confirm('确认删除该会话及其结果吗?');
    if (!confirmDelete) {
      return;
    }

    try {
      await optimizationAPI.deleteSession(session.session_id);
      if (activeSession === session.session_id) {
        setActiveSession(null);
      }
      toast.success('会话已删除');
      await loadSessions();
    } catch (error) {
      console.error('删除会话失败:', error);
      toast.error(error.response?.data?.detail || '删除会话失败');
    }
  }, [activeSession, loadSessions]);

  const handleViewSession = useCallback((sessionId) => {
    navigate(`/session/${sessionId}`);
  }, [navigate]);

  const handleRetrySegment = useCallback(async (session) => {
    if (session.status !== 'failed') {
      return;
    }

    const confirmRetry = window.confirm('检测到会话执行失败。是否继续处理未完成的段落?');
    if (!confirmRetry) {
      return;
    }

    try {
      const response = await optimizationAPI.retryFailedSegments(session.session_id);
      setActiveSession(session.session_id);
      toast.success(response.data?.message || '已重新继续处理未完成段落');
      await loadSessions();
    } catch (error) {
      console.error('重试失败:', error);
      toast.error(error.response?.data?.detail || '重试失败，请稍后再试');
    }
  }, [loadSessions]);

  // 使用 useMemo 缓存当前活跃会话的数据
  const currentActiveSessionData = useMemo(() => {
    return sessions.find(s => s.session_id === activeSession);
  }, [sessions, activeSession]);

  const currentActiveWordSessionData = useMemo(() => {
    return wordSessions.find(s => s.session_id === activeWordSession);
  }, [wordSessions, activeWordSession]);


  return (
    <div className="min-h-screen bg-ios-background">
      {/* 顶部导航栏 - iOS Glass Style */}
      <nav className="bg-white/80 backdrop-blur-xl border-b border-ios-separator sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-[52px]">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-ios-blue rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-[17px] font-semibold text-black tracking-tight">
                AI 论文润色增强
              </h1>
            </div>
            
            <div className="flex items-center gap-4">
              {/* 队列状态 */}
              {queueStatus && (
                <div className="flex items-center gap-3 text-[13px]">
                  <div className="flex items-center gap-1.5 bg-gray-100 px-2 py-1 rounded-md">
                    <Users className="w-3.5 h-3.5 text-ios-gray" />
                    <span className="text-ios-gray font-medium">
                      {queueStatus.current_users}/{queueStatus.max_users}
                    </span>
                  </div>
                  {queueStatus.queue_length > 0 && (
                    <div className="flex items-center gap-1.5 bg-orange-50 px-2 py-1 rounded-md">
                      <Clock className="w-3.5 h-3.5 text-ios-orange" />
                      <span className="text-ios-orange font-medium">
                        {queueStatus.queue_length} 排队
                      </span>
                    </div>
                  )}
                </div>
              )}
              
              <button
                onClick={handleLogout}
                className="text-ios-red text-[17px] hover:opacity-70 transition-opacity font-normal"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧 - 输入区域 */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* 说明卡片 */}
            <div className="bg-white rounded-2xl shadow-ios overflow-hidden">
              <div className="p-4 flex items-start gap-3 bg-blue-50/50">
                <Info className="w-5 h-5 text-ios-blue flex-shrink-0 mt-0.5" />
                <div className="text-[15px] text-black">
                  <p className="font-semibold mb-1 text-ios-blue">当前模式说明</p>
                  <p className="text-gray-700 leading-relaxed">
                    {processingMode === 'paper_polish' && '仅进行论文润色，提升文本的学术性和表达质量。'}
                    {processingMode === 'paper_enhance' && '直接进行原创性增强，跳过润色阶段，适合已经润色过的文本。'}
                    {processingMode === 'paper_polish_enhance' && '先进行论文润色，然后自动进行原创性增强，两阶段处理。'}
                    {processingMode === 'emotion_polish' && '专为感情文章设计，生成更自然、更具人性化的表达。'}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-ios p-5">
              <div className="h-[40px] flex items-center mb-2">
                <h2 className="text-[20px] font-bold text-black tracking-tight pl-1">
                  新建任务
                </h2>
              </div>

              {/* 任务类型切换：文本粘贴 vs Word文档 */}
              <div className="flex bg-gray-100 p-1 rounded-xl mb-5 max-w-md">
                <button
                  type="button"
                  onClick={() => setTaskTab('text')}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-medium text-[13px] transition-all flex items-center justify-center gap-1.5 ${
                    taskTab === 'text'
                      ? 'bg-white text-black shadow-xs font-semibold'
                      : 'text-gray-500 hover:text-black'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>文本粘贴润色</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTaskTab('word')}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-medium text-[13px] transition-all flex items-center justify-center gap-1.5 ${
                    taskTab === 'word'
                      ? 'bg-white text-ios-blue shadow-xs font-semibold'
                      : 'text-gray-500 hover:text-black'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5 text-ios-blue flex-shrink-0" />
                  <span>Word 去AIGC & 降重</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPrincipleModal('overview');
                    }}
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 text-[11px] font-bold cursor-pointer transition-colors ml-0.5"
                    title="点击查看去 AIGC & 降重核心原理"
                  >
                    !
                  </span>
                </button>
              </div>

              {taskTab === 'word' ? (
                <div className="space-y-5">
                  {/* 处理模式选择 - 与 txt 文本模式一致 */}
                  <div>
                    <div className="mb-2 ml-1">
                      <label className="text-[13px] font-medium text-ios-gray uppercase tracking-wide">
                        选择模式
                      </label>
                    </div>
                    <div className="space-y-3">
                      {MODES_CONFIG.map((mode) => (
                        <label
                          key={mode.id}
                          className={`flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all border ${
                            processingMode === mode.id
                              ? 'bg-blue-50 border-ios-blue ring-1 ring-ios-blue/20'
                              : 'bg-white border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center min-w-0 flex-1">
                            <input
                              type="radio"
                              name="processingModeWord"
                              value={mode.id}
                              checked={processingMode === mode.id}
                              onChange={(e) => setProcessingMode(e.target.value)}
                              className="mr-3 w-5 h-5 text-ios-blue focus:ring-ios-blue border-gray-300 flex-shrink-0"
                            />
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className={`font-semibold text-[15px] ${processingMode === mode.id ? 'text-ios-blue' : 'text-black'}`}>
                                  {mode.title}
                                </span>
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100/70 text-ios-blue font-medium hidden sm:inline">
                                  {mode.badge}
                                </span>
                              </div>
                              <div className="text-[13px] text-ios-gray mt-0.5 truncate">
                                {mode.desc}
                              </div>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleUploadWordFile(e.dataTransfer.files[0]);
                      }
                    }}
                    className="border-2 border-dashed border-gray-300 hover:border-ios-blue rounded-2xl p-8 text-center transition-all bg-gray-50/50 hover:bg-blue-50/20"
                  >
                    <input
                      type="file"
                      id="word-upload-input"
                      accept=".docx"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleUploadWordFile(e.target.files[0]);
                        }
                      }}
                    />
                    <div className="w-16 h-16 bg-blue-50 text-ios-blue rounded-2xl flex items-center justify-center mx-auto mb-4">
                      {isUploadingWord ? (
                        <Loader2 className="w-8 h-8 animate-spin" />
                      ) : (
                        <FileUp className="w-8 h-8" />
                      )}
                    </div>
                    <h3 className="font-bold text-[17px] text-gray-800 mb-2">
                      {isUploadingWord ? '正在解析 Word 文档中...' : '上传 Word 文档 (.docx)'}
                    </h3>
                    <p className="text-[13px] text-gray-500 max-w-md mx-auto leading-relaxed mb-6">
                      完整还原论文排版格式，智能标红待修改的高危/模板语句。点击红句即可查看 3 条高质量学术改写建议并一键替换确认，最终可直接导出修改后的 Word 文档。
                    </p>
                    <button
                      type="button"
                      disabled={isUploadingWord}
                      onClick={() => document.getElementById('word-upload-input')?.click()}
                      className="inline-flex items-center gap-2 bg-ios-blue hover:bg-blue-600 disabled:bg-gray-300 text-white font-semibold py-2.5 px-7 rounded-xl shadow-xs transition-all text-[15px] active:scale-[0.98]"
                    >
                      <Upload className="w-4 h-4" />
                      <span>{isUploadingWord ? '解析处理中...' : '选择本地 .docx 文档并开始'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* 处理模式选择 - iOS Segmented Control Style */}
                  <div className="mb-5">
                    <div className="mb-2 ml-1">
                      <label className="text-[13px] font-medium text-ios-gray uppercase tracking-wide">
                        选择模式
                      </label>
                    </div>
                    <div className="space-y-3">
                      {MODES_CONFIG.map((mode) => (
                        <label
                          key={mode.id}
                          className={`flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all border ${
                            processingMode === mode.id
                              ? 'bg-blue-50 border-ios-blue ring-1 ring-ios-blue/20'
                              : 'bg-white border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center min-w-0 flex-1">
                            <input
                              type="radio"
                              name="processingMode"
                              value={mode.id}
                              checked={processingMode === mode.id}
                              onChange={(e) => setProcessingMode(e.target.value)}
                              className="mr-3 w-5 h-5 text-ios-blue focus:ring-ios-blue border-gray-300 flex-shrink-0"
                            />
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className={`font-semibold text-[15px] ${processingMode === mode.id ? 'text-ios-blue' : 'text-black'}`}>
                                  {mode.title}
                                </span>
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100/70 text-ios-blue font-medium hidden sm:inline">
                                  {mode.badge}
                                </span>
                              </div>
                              <div className="text-[13px] text-ios-gray mt-0.5 truncate">
                                {mode.desc}
                              </div>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  
                  <div className="relative">
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="在此粘贴您的内容..."
                      className="w-full h-64 px-4 py-3 bg-gray-50 rounded-xl focus:bg-white focus:ring-2 focus:ring-ios-blue/20 transition-all text-[16px] leading-relaxed text-black placeholder-gray-400 border-none outline-none resize-none"
                    />
                    <div className="absolute bottom-3 right-3 text-[12px] text-ios-gray bg-white/80 px-2 py-1 rounded-md backdrop-blur-sm">
                      {text.length} 字
                    </div>
                  </div>
                  
                  <div className="mt-5 flex justify-end">
                    <button
                      onClick={handleStartOptimization}
                      disabled={!text.trim() || activeSession || isSubmitting}
                      className="flex items-center gap-2 bg-ios-blue hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-8 rounded-xl transition-all active:scale-[0.98] shadow-sm text-[17px]"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          提交中...
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5 fill-current" />
                          开始优化
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 活跃会话进度 */}
            {activeSession && currentActiveSessionData && (
              <div className="bg-white rounded-2xl shadow-ios p-5 border border-blue-100">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[17px] font-bold text-black flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-ios-blue animate-pulse" />
                    正在处理
                  </h2>
                  <span className="text-[13px] font-medium px-2 py-1 bg-blue-50 text-ios-blue rounded-md">
                    进行中
                  </span>
                </div>

                {(() => {
                  const session = currentActiveSessionData;
                  const getStageName = (stage) => {
                    if (stage === 'polish') return '论文润色';
                    if (stage === 'emotion_polish') return '感情文章润色';
                    if (stage === 'enhance') return '原创性增强';
                    return stage;
                  };
                  return (
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-[13px] mb-2 font-medium">
                          <span className="text-ios-gray">
                            当前阶段: <span className="text-black">{getStageName(session.current_stage)}</span>
                          </span>
                          <span className="text-ios-blue">
                            {session.progress.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div
                            className="bg-ios-blue h-2 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(0,122,255,0.3)]"
                            style={{ width: `${session.progress}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex justify-between items-center text-[13px]">
                        <span className="text-ios-gray">
                          进度: <span className="font-medium text-black">{session.current_position + 1}</span> / {session.total_segments} 段
                        </span>

                        {session.status === 'queued' && queueStatus?.your_position && (
                          <div className="flex items-center gap-1.5 text-ios-orange">
                            <Clock className="w-3.5 h-3.5" />
                            <span>
                              排队第 {queueStatus.your_position} 位
                              (~{Math.ceil(queueStatus.estimated_wait_time / 60)}分)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 活跃 Word 会话进度 - 按照 txt 优化流程 */}
            {activeWordSession && currentActiveWordSessionData && (
              <div className="bg-white rounded-2xl shadow-ios p-5 border border-blue-100">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[17px] font-bold text-black flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-ios-blue animate-pulse" />
                    Word 文档检索与优化处理中
                  </h2>
                  <span className="text-[13px] font-medium px-2 py-1 bg-blue-50 text-ios-blue rounded-md">
                    {MODE_NAMES[currentActiveWordSessionData.processing_mode] || '润色 + 增强'}
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                    <FileText className="w-4 h-4 text-ios-blue flex-shrink-0" />
                    <span className="truncate">{currentActiveWordSessionData.filename}</span>
                  </div>

                  <div>
                    <div className="flex justify-between text-[13px] mb-2 font-medium">
                      <span className="text-ios-gray">
                        当前阶段: <span className="text-black">
                          {currentActiveWordSessionData.current_stage === 'scanning'
                            ? '正在扫描文档版式与AIGC高危句段...'
                            : currentActiveWordSessionData.current_stage === 'generating'
                            ? `正在为需要优化的句段生成 3 条改写推荐方案 (${(currentActiveWordSessionData.current_position || 0) + 1} / ${currentActiveWordSessionData.total_to_process || currentActiveWordSessionData.need_mod_count || 1} 处)`
                            : '文档全量检索与建议生成已完成'}
                        </span>
                      </span>
                      <span className="text-ios-blue font-bold">
                        {(currentActiveWordSessionData.progress || 0).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-ios-blue h-2 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(0,122,255,0.3)]"
                        style={{ width: `${currentActiveWordSessionData.progress || 10}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-1 text-[13px]">
                    <span className="text-gray-500">
                      待优化标注句段: <strong>{currentActiveWordSessionData.need_mod_count || 0}</strong> 处
                    </span>
                    <button
                      onClick={() => navigate(`/word-session/${currentActiveWordSessionData.session_id}`)}
                      className="inline-flex items-center gap-1.5 text-ios-blue hover:text-blue-700 font-semibold bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <span>进入查看文档</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 右侧 - 历史会话 */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-ios overflow-hidden flex flex-col h-[calc(100vh-140px)] sticky top-24">
              <div className="p-4 border-b border-gray-100 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-ios-gray" />
                  <h2 className="text-[17px] font-bold text-black tracking-tight">
                    {taskTab === 'word' ? 'Word 去AIGC & 降重记录' : '文本润色记录'}
                  </h2>
                </div>

                <div className="flex bg-gray-100 p-0.5 rounded-lg text-[12px] font-medium">
                  <button
                    type="button"
                    onClick={() => setTaskTab('text')}
                    className={`px-2 py-0.5 rounded-md transition-all ${
                      taskTab === 'text' ? 'bg-white text-black shadow-xs font-semibold' : 'text-gray-500'
                    }`}
                  >
                    文本
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskTab('word')}
                    className={`px-2 py-0.5 rounded-md transition-all ${
                      taskTab === 'word' ? 'bg-white text-ios-blue shadow-xs font-semibold' : 'text-gray-500'
                    }`}
                  >
                    Word
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar h-full">
                {taskTab === 'word' ? (
                  isLoadingWordSessions ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-6 h-6 border-2 border-ios-gray/30 border-t-ios-gray rounded-full animate-spin" />
                    </div>
                  ) : wordSessions.length === 0 ? (
                    <div className="text-center py-12 space-y-2">
                      <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto text-ios-blue">
                        <FileText className="w-6 h-6" />
                      </div>
                      <p className="text-ios-gray text-sm">
                        暂无 Word 去AIGC & 降重文档
                      </p>
                    </div>
                  ) : (
                    wordSessions.map((session) => (
                      <WordSessionItem
                        key={session.session_id}
                        session={session}
                        onView={handleViewWordSession}
                        onDelete={handleDeleteWordSession}
                      />
                    ))
                  )
                ) : (
                  isLoadingSessions ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-6 h-6 border-2 border-ios-gray/30 border-t-ios-gray rounded-full animate-spin" />
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="text-center py-12 space-y-2">
                      <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-300">
                        <History className="w-6 h-6" />
                      </div>
                      <p className="text-ios-gray text-sm">
                        暂无会话记录
                      </p>
                    </div>
                  ) : (
                    sessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        activeSession={activeSession}
                        onView={handleViewSession}
                        onDelete={handleDeleteSession}
                        onRetry={handleRetrySegment}
                      />
                    ))
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 技术原理解析与模式指南弹窗 */}
      {showPrincipleModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in"
          onClick={() => setShowPrincipleModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-gray-100 animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[16px] sm:text-[17px] text-gray-900">
                    去 AIGC & 降重技术原理与模式指南
                  </h3>
                  <p className="text-[12px] text-gray-500">
                    知网/万方/PaperPass/维普检测对抗机制与算法逻辑全解
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPrincipleModal(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 rounded-lg transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 顶部 Tab 切换 */}
            <div className="flex border-b border-gray-200 bg-gray-100/70 p-1.5 gap-1 overflow-x-auto custom-scrollbar flex-shrink-0">
              <button
                onClick={() => setShowPrincipleModal('overview')}
                className={`py-1.5 px-3 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap ${
                  showPrincipleModal === 'overview'
                    ? 'bg-white text-ios-blue shadow-xs font-semibold'
                    : 'text-gray-600 hover:text-black'
                }`}
              >
                🔍 核心原理总览
              </button>
              {MODES_CONFIG.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setShowPrincipleModal(m.id)}
                  className={`py-1.5 px-3 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap ${
                    showPrincipleModal === m.id
                      ? 'bg-white text-ios-blue shadow-xs font-semibold'
                      : 'text-gray-600 hover:text-black'
                  }`}
                >
                  {m.title}
                </button>
              ))}
            </div>

            {/* 弹窗主体内容 */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 custom-scrollbar">
              {showPrincipleModal === 'overview' ? (
                <div className="space-y-4 text-gray-700 text-[14px] leading-relaxed">
                  {/* 核心对抗机制 */}
                  <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-4">
                    <h4 className="font-bold text-blue-900 text-[15px] mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-ios-blue" />
                      一、知网 3.0 / 万方 / PaperPass 的 AIGC 检测原理
                    </h4>
                    <p className="text-[13px] text-gray-600 mb-3">
                      目前主流学术 AIGC 检测系统并非凭空猜测，而是基于以下三大统计学和自然语言处理（NLP）特征进行打分判定：
                    </p>
                    <div className="space-y-2.5 text-[13px]">
                      <div className="bg-white p-3 rounded-lg border border-blue-100/80">
                        <div className="font-semibold text-gray-800 mb-0.5">
                          1. 困惑度 (Perplexity, PPL) — 词汇概率平滑性
                        </div>
                        <div className="text-gray-600">
                          大模型生成文本基于统计概率“选出最可能的下一个词”，因此词与词之间的困惑度极低且极其均匀。而人类写作者在选词、成句时具有高度的个性化跳跃性。系统通过<strong>学术倒装、近义学术术语穿插、语序重排</strong>有效打破平滑分布。
                        </div>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-blue-100/80">
                        <div className="font-semibold text-gray-800 mb-0.5">
                          2. 突发度 (Burstiness) — 句式长短与节奏变化
                        </div>
                        <div className="text-gray-600">
                          AI 文本在句式长短、标点停顿上表现出高度均匀的节律。系统通过<strong>长复合句拆解、短句嵌入、排比与非典型句式交替</strong>，重塑人类思维典型的长短句突发波峰。
                        </div>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-blue-100/80">
                        <div className="font-semibold text-gray-800 mb-0.5">
                          3. 高频大模型模板套话 (N-gram 模式匹配)
                        </div>
                        <div className="text-gray-600">
                          AI 文本极易出现“从...视阈看”、“把...作为...之一”、“综上所述”、“具有重要意义/深远价值”、“深度赋能”、“协同发力”等空洞套话。系统内置 <strong>8 大类 50+ 种高危特征库</strong>，精准捕获并替换为有实质论据支撑的学术表述。
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 降低查重率原理 */}
                  <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-4">
                    <h4 className="font-bold text-emerald-900 text-[15px] mb-2 flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      二、降重（降低传统查重复制比）机制
                    </h4>
                    <p className="text-[13px] text-gray-600 leading-relaxed">
                      知网查重系统以“连续 13 个字符相似”为标红阈值。本系统在<strong>严密保持专有名词、实验数据与因果逻辑</strong>的前提下，对主谓宾骨架重新编码，改变从句从属关系与语态，使连续重复字符完全跌破判定阈值，<strong>兼顾 AIGC 降疑似度与传统查重降重</strong>。
                    </p>
                  </div>
                </div>
              ) : (
                (() => {
                  const currentMode = MODES_CONFIG.find(m => m.id === showPrincipleModal) || MODES_CONFIG[0];
                  return (
                    <div className="space-y-4">
                      <div className="bg-gray-50 border border-gray-200/80 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-[16px] text-gray-900">
                            {currentMode.title}
                          </span>
                          <span className="text-[12px] px-2.5 py-0.5 rounded-full bg-blue-100 text-ios-blue font-semibold">
                            {currentMode.badge}
                          </span>
                        </div>
                        <p className="text-[14px] text-gray-700 font-medium mb-1">
                          {currentMode.principleTitle}
                        </p>
                        <p className="text-[13px] text-gray-500 leading-relaxed">
                          {currentMode.principleSummary}
                        </p>
                      </div>

                      <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-white shadow-xs">
                        <h5 className="font-bold text-[14px] text-gray-800 flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-amber-500" />
                          底层算法与处理机制
                        </h5>
                        <p className="text-[13px] text-gray-600 leading-relaxed">
                          {currentMode.mechanism}
                        </p>

                        <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-2">
                          {currentMode.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="text-[12px] bg-blue-50 text-ios-blue px-2.5 py-1 rounded-md font-medium border border-blue-100/60"
                            >
                              ✓ {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 flex items-start gap-2.5 text-[13px] text-amber-800">
                        <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <strong>使用建议：</strong>
                          {currentMode.id === 'paper_polish_enhance'
                            ? '这是针对毕业论文、学术专著的最强方案，一次性兼顾破除 AIGC 痕迹与提升学术润色质量。'
                            : currentMode.id === 'paper_enhance'
                            ? '若论文查重报告中 AIGC 疑似度过高（如 > 40%），建议首选此模式进行深度句式打破与去痕。'
                            : currentMode.id === 'paper_polish'
                            ? '若论文查重已达标，但导师指出文字晦涩、语病多、缺乏学术规范，建议选择此模式精细打磨。'
                            : '适用于文学随笔、散文与评述，消除机器说教，还原自然真挚的人文情感表达。'}
                        </div>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {/* 弹窗底部操作 */}
            <div className="p-4 border-t border-gray-100 bg-gray-50/80 flex items-center justify-between">
              <span className="text-[12px] text-gray-500">
                点击外部空白处或右上角可关闭指南
              </span>
              <button
                onClick={() => setShowPrincipleModal(null)}
                className="px-5 py-2 bg-ios-blue text-white rounded-xl text-[14px] font-medium hover:bg-blue-600 transition-colors shadow-xs"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspacePage;
