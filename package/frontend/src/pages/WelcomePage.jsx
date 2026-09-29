import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Shield, ArrowRight, AlertCircle, Mail, Key, Check, Copy, Sparkles, RefreshCw } from 'lucide-react';
import axios from 'axios';
import { healthAPI, authAPI } from '../api';

const WelcomePage = () => {
  // 模式切换: 'login' (卡密登录) 或 'register' (邮箱获取卡密)
  const [activeTab, setActiveTab] = useState('login');

  // 卡密登录状态
  const [cardKey, setCardKey] = useState('');
  const [showWarning, setShowWarning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState(null);

  // 邮箱注册/获取卡密状态
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [issuedCardKey, setIssuedCardKey] = useState(null);
  const [copied, setCopied] = useState(false);

  const countdownTimerRef = useRef(null);
  const navigate = useNavigate();

  // 检查 API 可用性 - 静默检查
  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        const response = await healthAPI.checkModels();
        const data = response.data;
        setApiStatus(data);
        
        if (data.overall_status === 'degraded') {
          const unavailableModels = Object.entries(data.models)
            .filter(([_, model]) => model.status === 'unavailable')
            .map(([name, _]) => name);
          
          const allUnavailable = unavailableModels.length === Object.keys(data.models).length;
          if (allUnavailable) {
            console.warn('所有 AI 模型配置检查未通过，请联系管理员检查配置。');
          }
        }
      } catch (error) {
        console.error('API health check failed:', error);
      }
    };

    checkApiHealth();

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  // 倒计时逻辑
  const startCountdown = (seconds = 60) => {
    setCountdown(seconds);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // 发送邮箱验证码
  const handleSendCode = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error('请输入邮箱地址');
      return;
    }

    const emailRegex = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('请输入正确的邮箱格式');
      return;
    }

    setSendingCode(true);
    try {
      const response = await authAPI.sendCode(trimmedEmail);
      if (response.data.success) {
        toast.success(response.data.message || '验证码已发送至您的邮箱');
        startCountdown(response.data.remaining_seconds || 60);
        // 如果后端处于未配置 SMTP 的调试模式，贴心自动填入并提示
        if (response.data.debug_code) {
          setCode(response.data.debug_code);
          toast((t) => (
            <div className="text-xs">
              <span className="font-bold text-amber-600">测试模式提示：</span>服务端未配置发信邮箱凭据，验证码 <code>{response.data.debug_code}</code> 已为您自动填入！
            </div>
          ), { duration: 8000 });
        }
      }
    } catch (error) {
      const msg = error.response?.data?.detail || '发送验证码失败，请稍后重试';
      toast.error(msg);
    } finally {
      setSendingCode(false);
    }
  };

  // 校验验证码并获取专属卡密
  const handleVerifyCode = async () => {
    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();

    if (!trimmedEmail) {
      toast.error('请输入邮箱地址');
      return;
    }
    if (!trimmedCode) {
      toast.error('请输入 6 位数验证码');
      return;
    }

    setVerifyingCode(true);
    try {
      const response = await authAPI.verifyCode(trimmedEmail, trimmedCode);
      if (response.data.success && response.data.card_key) {
        const receivedKey = response.data.card_key;
        setIssuedCardKey(receivedKey);
        setCardKey(receivedKey);
        toast.success(response.data.message || '验证成功！卡密已发放');
      }
    } catch (error) {
      const msg = error.response?.data?.detail || '验证失败，请检查验证码是否正确';
      toast.error(msg);
    } finally {
      setVerifyingCode(false);
    }
  };

  // 复制卡密
  const handleCopyKey = () => {
    if (!issuedCardKey) return;
    navigator.clipboard.writeText(issuedCardKey);
    setCopied(true);
    toast.success('卡密已复制到剪贴板');
    setTimeout(() => setCopied(false), 2000);
  };

  // 验证卡密并继续
  const handleContinue = async (keyToVerify = cardKey) => {
    const activeKey = (keyToVerify || '').trim();
    if (!activeKey) {
      toast.error('请输入卡密');
      return;
    }

    // 检查 API 状态
    if (apiStatus && apiStatus.overall_status === 'degraded') {
      const allUnavailable = Object.values(apiStatus.models).every(
        model => model.status === 'unavailable'
      );
      
      if (allUnavailable) {
        toast.error('所有 AI 模型当前不可用，无法使用系统。请联系管理员。');
        return;
      } else {
        toast.warning('部分 AI 模型不可用，系统功能可能受限。');
      }
    }
    
    // 验证卡密
    setLoading(true);
    try {
      const response = await axios.post('/api/admin/verify-card-key', {
        card_key: activeKey
      });
      
      if (response.data.valid) {
        setCardKey(activeKey);
        setShowWarning(true);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || '卡密验证失败，请检查卡密是否正确');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = () => {
    localStorage.setItem('cardKey', cardKey);
    navigate('/workspace');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex flex-col items-center justify-center p-4 sm:p-6 relative">
      {/* 管理后台快捷入口 */}
      <button
        onClick={() => navigate('/admin')}
        className="fixed top-6 left-6 px-4 py-2.5 bg-white/70 backdrop-blur-xl border border-white/20 shadow-lg hover:bg-white/80 text-gray-800 rounded-2xl transition-all active:scale-95 flex items-center gap-2 text-sm font-medium z-10"
      >
        <Shield className="w-4 h-4 text-blue-600" />
        管理后台
      </button>

      <div className="max-w-md w-full space-y-6">
        {!showWarning ? (
          <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20 p-8 space-y-6 animate-fade-in-up">
            {/* Logo/标题区域 */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-ios-blue rounded-[22px] shadow-lg mb-1">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-black tracking-tight">
                  AI 学术写作助手
                </h1>
                <p className="text-ios-gray text-sm mt-1">
                  专业论文润色 · 智能语言优化 · 去 AIGC 降重
                </p>
              </div>
            </div>

            {/* iOS 风格分段控制器 (Segmented Control) */}
            <div className="bg-gray-100/80 p-1 rounded-2xl flex relative">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('login');
                  setIssuedCardKey(null);
                }}
                className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 ${
                  activeTab === 'login'
                    ? 'bg-white text-black shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                卡密登录
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('register')}
                className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 ${
                  activeTab === 'register'
                    ? 'bg-white text-black shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                邮箱获取卡密
              </button>
            </div>

            {/* TAB 1: 卡密登录 */}
            {activeTab === 'login' && (
              <div className="space-y-5 animate-fade-in">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-ios-gray ml-1">
                    系统访问卡密
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={cardKey}
                      onChange={(e) => setCardKey(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && !loading && cardKey.trim() && handleContinue()}
                      placeholder="请输入您的卡密 (如 AIGC-XXXX)"
                      className="w-full px-4 py-3.5 bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/60 focus:bg-white focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue/50 transition-all text-black placeholder-gray-400 outline-none text-[16px]"
                    />
                  </div>
                </div>

                <button
                  onClick={() => handleContinue()}
                  disabled={loading || !cardKey.trim()}
                  className="w-full bg-ios-blue hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 px-6 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-[17px] shadow-lg hover:shadow-xl"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      验证中...
                    </>
                  ) : (
                    <>
                      开始使用
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('register')}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1 transition-colors"
                  >
                    没有卡密？点此输入邮箱免费获取
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: 邮箱获取卡密 */}
            {activeTab === 'register' && (
              <div className="space-y-5 animate-fade-in">
                {/* 已经获取成功的卡密展示卡片 */}
                {issuedCardKey ? (
                  <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-5 space-y-4 text-center animate-scale-in">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-emerald-500 rounded-2xl text-white shadow-md">
                      <Sparkles className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-gray-900">您的专属卡密已生成！</h3>
                      <p className="text-xs text-gray-500 mt-1">卡密已同步发送至您的邮箱：{email}</p>
                    </div>

                    <div className="bg-white border border-emerald-300/80 rounded-xl p-3 flex items-center justify-between shadow-inner">
                      <span className="font-mono text-base font-extrabold text-emerald-800 tracking-wider select-all">
                        {issuedCardKey}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyKey}
                        className="px-2.5 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all active:scale-95"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            已复制
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            复制
                          </>
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleContinue(issuedCardKey)}
                      disabled={loading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-6 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-[16px] shadow-md"
                    >
                      {loading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          进入中...
                        </>
                      ) : (
                        <>
                          立即进入工作台
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>

                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIssuedCardKey(null);
                          setCode('');
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        使用其他邮箱获取
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 邮箱输入 */}
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-ios-gray ml-1">
                        接收卡密的邮箱
                      </label>
                      <div className="relative">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="例如 user@gwm.cn 或 user@qq.com"
                          className="w-full px-4 py-3.5 bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/60 focus:bg-white focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue/50 transition-all text-black placeholder-gray-400 outline-none text-[16px]"
                        />
                      </div>
                    </div>

                    {/* 验证码输入 + 获取按钮 */}
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-ios-gray ml-1">
                        邮箱验证码
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={code}
                          maxLength={6}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                          onKeyPress={(e) => e.key === 'Enter' && !verifyingCode && code.trim() && handleVerifyCode()}
                          placeholder="6 位数字验证码"
                          className="flex-1 px-4 py-3.5 bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/60 focus:bg-white focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue/50 transition-all text-black placeholder-gray-400 outline-none text-[16px] tracking-widest font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleSendCode}
                          disabled={sendingCode || countdown > 0 || !email.trim()}
                          className="px-4 py-3.5 bg-blue-50 hover:bg-blue-100 disabled:bg-gray-100 disabled:text-gray-400 text-blue-600 font-semibold rounded-xl text-sm transition-all border border-blue-100 disabled:border-transparent whitespace-nowrap active:scale-95"
                        >
                          {sendingCode ? (
                            <span className="flex items-center gap-1.5">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              发送中
                            </span>
                          ) : countdown > 0 ? (
                            `${countdown}s 后重发`
                          ) : (
                            '获取验证码'
                          )}
                        </button>
                      </div>
                    </div>

                    {/* 提交验证按钮 */}
                    <button
                      onClick={handleVerifyCode}
                      disabled={verifyingCode || !email.trim() || !code.trim()}
                      className="w-full bg-ios-blue hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 px-6 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-[17px] shadow-lg hover:shadow-xl mt-2"
                    >
                      {verifyingCode ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          验证并领取卡密中...
                        </>
                      ) : (
                        <>
                          验证并获取卡密
                          <ArrowRight className="w-5 h-5" />
                        </>
                      )}
                    </button>

                    <div className="text-center pt-1">
                      <button
                        type="button"
                        onClick={() => setActiveTab('login')}
                        className="text-xs text-ios-gray hover:text-gray-700 transition-colors"
                      >
                        已有卡密？点此直接登录
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 底部提示 */}
            <div className="text-center pt-2 border-t border-gray-100/60">
              <p className="text-xs text-ios-gray">
                使用本系统即表示您同意遵守学术诚信规范
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20 p-8 space-y-6 animate-scale-in">
            {/* 图标和标题 */}
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-ios-orange rounded-[18px] shadow-md mb-4">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-bold text-black tracking-tight mb-1">
                学术诚信承诺
              </h2>
              <p className="text-sm text-ios-gray">请仔细阅读以下条款</p>
            </div>

            {/* 条款内容 */}
            <div className="bg-gray-50 rounded-xl p-5 space-y-4">
              <div className="space-y-3 text-black text-[15px] leading-relaxed">
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 bg-ios-orange text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">1</span>
                  <p>本系统仅作为语言润色与表达增强工具，不应替代原创研究与学术思考</p>
                </div>
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 bg-ios-orange text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">2</span>
                  <p>论文的核心观点、研究方法、实验数据必须为您的原创工作</p>
                </div>
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 bg-ios-orange text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">3</span>
                  <p>您需审核所有优化建议与内容，并对最终提交的论文负全部责任</p>
                </div>
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 bg-ios-orange text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">4</span>
                  <p>根据相关学术机构规定，您可能需要在论文致谢中声明使用了 AI 辅助工具</p>
                </div>
              </div>
            </div>

            {/* 警告提示 */}
            <div className="bg-red-50 rounded-xl p-4">
              <div className="flex gap-3 items-start">
                <AlertCircle className="w-5 h-5 text-ios-red flex-shrink-0 mt-0.5" />
                <p className="text-ios-red text-sm font-medium">
                  学术不端行为可能导致严重后果，包括论文撤稿、学位取消等
                </p>
              </div>
            </div>

            {/* 按钮组 */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setShowWarning(false)}
                className="bg-gray-100 hover:bg-gray-200 text-black font-medium py-3.5 px-6 rounded-xl transition-all active:scale-[0.98] text-[17px]"
              >
                返回
              </button>
              <button
                onClick={handleAccept}
                className="bg-ios-green hover:bg-green-600 text-white font-semibold py-3.5 px-6 rounded-xl transition-all active:scale-[0.98] text-[17px]"
              >
                同意并继续
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WelcomePage;
