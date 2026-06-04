import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '@/services/api';

function StatifyLogo({ size = 40, variant = 'white', className = '' }) {
  const src = variant === 'white' ? '/statify-icon-white.svg' : '/statify-icon.svg';
  return <img src={src} alt="Statify" width={size} height={size} className={className} />;
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading]   = useState(false);
  const [showPwd, setShowPwd]   = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const [success, setSuccess]   = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm();
  const newPassword = watch('newPassword');

  const onSubmit = async (data) => {
    if (!token) {
      setServerErr('Invalid reset link. Please request a new one.');
      return;
    }
    setLoading(true);
    setServerErr('');
    try {
      await api.post('/auth/reset-password', { token, newPassword: data.newPassword });
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 3000);
    } catch (err) {
      setServerErr(err?.response?.data?.message || 'Failed to reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(160deg, #ecf5f7 0%, #ffffff 55%, #fff8eb 100%)' }}
    >
      <div className="w-full max-w-md">
        <div
          className="overflow-hidden rounded-3xl shadow-2xl"
          style={{ background: 'linear-gradient(160deg, #024A59 0%, #011920 100%)' }}
        >
          <div className="h-1 w-full bg-gradient-to-r from-secondary-400 via-secondary-500 to-secondary-400" />

          <div className="px-8 pb-8 pt-7">
            <div className="mb-5 flex items-center gap-2">
              <StatifyLogo size={28} variant="white" />
              <span className="text-sm font-extrabold tracking-widest text-white">STATIFY</span>
              <span className="text-sm font-light text-secondary-400">POS</span>
            </div>

            {success ? (
              <div className="py-4 text-center">
                <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-secondary-400" />
                <h2 className="text-xl font-bold text-white">Password Reset!</h2>
                <p className="mt-2 text-sm text-white/60">
                  Your password has been updated. Redirecting you to sign in…
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-white">Set new password</h2>
                <p className="mt-1 text-sm text-white/50">Choose a strong password for your account.</p>

                {!token && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-3 text-sm text-amber-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Invalid or missing reset token. Please request a new password reset link.</span>
                  </div>
                )}

                {serverErr && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/15 px-4 py-3 text-sm text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{serverErr}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4" noValidate>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white/70">New password</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-white/30">
                        <Lock className="h-4 w-4" />
                      </span>
                      <input
                        type={showPwd ? 'text' : 'password'}
                        placeholder="Min 6 characters"
                        autoFocus
                        className={[
                          'login-input block w-full rounded-xl border text-sm pl-10 pr-11 py-3 transition-colors',
                          'bg-[#011d26] text-white placeholder-white/50',
                          'focus:outline-none focus:ring-2 focus:ring-secondary-400/60 focus:border-secondary-400/60',
                          errors.newPassword ? 'border-red-400/50' : 'border-white/10 hover:border-white/20',
                        ].join(' ')}
                        {...register('newPassword', {
                          required: 'Password is required',
                          minLength: { value: 6, message: 'At least 6 characters' },
                        })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd((v) => !v)}
                        className="absolute inset-y-0 right-3.5 flex items-center text-white/30 hover:text-white/60"
                        tabIndex={-1}
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.newPassword && <p className="text-xs text-red-400">{errors.newPassword.message}</p>}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white/70">Confirm password</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-white/30">
                        <Lock className="h-4 w-4" />
                      </span>
                      <input
                        type={showConf ? 'text' : 'password'}
                        placeholder="Repeat password"
                        className={[
                          'login-input block w-full rounded-xl border text-sm pl-10 pr-11 py-3 transition-colors',
                          'bg-[#011d26] text-white placeholder-white/50',
                          'focus:outline-none focus:ring-2 focus:ring-secondary-400/60 focus:border-secondary-400/60',
                          errors.confirmPassword ? 'border-red-400/50' : 'border-white/10 hover:border-white/20',
                        ].join(' ')}
                        {...register('confirmPassword', {
                          required: 'Please confirm your password',
                          validate: (v) => v === newPassword || 'Passwords do not match',
                        })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConf((v) => !v)}
                        className="absolute inset-y-0 right-3.5 flex items-center text-white/30 hover:text-white/60"
                        tabIndex={-1}
                      >
                        {showConf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.confirmPassword && <p className="text-xs text-red-400">{errors.confirmPassword.message}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !token}
                    className={[
                      'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 mt-1',
                      'bg-secondary-500 text-sm font-bold text-primary-900 transition-all',
                      'hover:bg-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-400',
                      'disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-secondary-500/20',
                    ].join(' ')}
                  >
                    {loading ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Resetting…
                      </>
                    ) : 'Set new password'}
                  </button>
                </form>

                <p className="mt-5 text-center text-xs text-white/30">
                  Remember your password?{' '}
                  <Link to="/login" className="text-secondary-400 hover:text-secondary-300">Sign in</Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
