import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, LoaderCircle, Mail, Lock, User, CheckCircle, Sparkles, Calendar, Activity, Ruler, Building2, Phone, BriefcaseMedical, IdCard, GraduationCap, Briefcase } from 'lucide-react';
import { mongodb } from '../lib/mongodbClient';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'framer-motion';
import Logo from '../components/Logo';
import { getDashboardRouteForRole } from '../services/healthcareApi';
import type { UserRole } from '../types/healthcare';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [weight, setWeight] = useState<number | ''>('');
  const [height, setHeight] = useState<number | ''>('');
  const [clinicalStage, setClinicalStage] = useState('');
  const [role, setRole] = useState<UserRole>('patient');
  const [phone, setPhone] = useState('');
  const [hospital, setHospital] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [doctorIdentifier, setDoctorIdentifier] = useState('');
  const [doctorAge, setDoctorAge] = useState<number | ''>('');
  const [doctorGender, setDoctorGender] = useState('');
  const [qualification, setQualification] = useState('');
  const [yearsExperience, setYearsExperience] = useState<number | ''>('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      navigate(getDashboardRouteForRole(user.role));
    }
  }, [user, navigate]);

  const resetSignupFields = () => {
    setFullName('');
    setGender('');
    setDateOfBirth('');
    setWeight('');
    setHeight('');
    setClinicalStage('');
    setPhone('');
    setHospital('');
    setSpecialties('');
    setDoctorIdentifier('');
    setDoctorAge('');
    setDoctorGender('');
    setQualification('');
    setYearsExperience('');
    setConsent(false);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (isLogin) {
        const { data, error } = await mongodb.signIn(email, password);
        if (error) throw new Error(error);
        if (data?.access_token && data?.user) {
          navigate(getDashboardRouteForRole(data.user.role));
        } else {
          throw new Error('Sign in failed');
        }
      } else {
        const { data, error } = await mongodb.signUp(
          email,
          password,
          fullName,
          role === 'patient' ? gender : undefined,
          role === 'patient' ? dateOfBirth : undefined,
          role === 'patient' && weight !== '' ? Number(weight) : undefined,
          role === 'patient' && height !== '' ? Number(height) : undefined,
          role === 'patient' ? clinicalStage || undefined : undefined,
          role,
          phone || undefined,
          role === 'doctor' ? hospital || undefined : undefined,
          role === 'doctor'
            ? specialties.split(',').map((item) => item.trim()).filter(Boolean)
            : undefined,
          role === 'doctor' ? doctorIdentifier || undefined : undefined,
          role === 'doctor' && doctorAge !== '' ? Number(doctorAge) : undefined,
          role === 'doctor' ? doctorGender || undefined : undefined,
          role === 'doctor' ? qualification || undefined : undefined,
          role === 'doctor' && yearsExperience !== '' ? Number(yearsExperience) : undefined,
        );
        if (error) throw new Error(error);
        if (data?.user?.role === 'doctor' && data.user.approval_status === 'pending') {
          setMessage('Doctor account created successfully. You can sign in only after an admin approves your account.');
          setIsLogin(true);
          setPassword('');
          resetSignupFields();
          mongodb.clearToken();
        } else if (data?.access_token && data?.user) {
          navigate(getDashboardRouteForRole(data.user.role));
        } else {
          throw new Error('Sign up failed');
        }
      }
    } catch (error: any) {
      const message = error?.message ?? 'An unexpected error occurred.';
      console.error('Authentication request failed', { error, apiUrl });

      if (message.includes('Failed to fetch') || error instanceof TypeError) {
        setError(`Unable to reach API at ${apiUrl}. Check your internet connection and make sure the backend server is running.`);
      } else if (message.includes('already exists')) {
        setError('User with this email already exists. Please sign in instead.');
      } else if (message.toLowerCase().includes('waiting for admin approval')) {
        setError('Doctor account is waiting for admin approval. Please sign in after approval.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4 relative overflow-hidden">
      {/* Animated background blobs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000" />
      <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-white p-8 rounded-2xl shadow-2xl border border-gray-100">
          {/* Logo and Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <button
                type="button"
                onClick={() => navigate('/admin-login')}
                className="rounded-xl transition-transform hover:scale-[1.02]"
                title="Admin login"
              >
                <Logo size="lg" />
              </button>
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-sm font-medium mb-3">
                <Sparkles className="h-4 w-4" />
                <span>AI-Powered Care</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {isLogin ? 'Welcome Back' : 'Create Account'}
              </h1>
              <p className="text-gray-600">
                {isLogin ? 'Sign in to continue your health journey' : 'Join us to take control of your health'}
              </p>
            </motion.div>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {!isLogin && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Type</label>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {([
                    { value: 'patient', label: 'Patient' },
                    { value: 'doctor', label: 'Doctor' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRole(option.value)}
                      className={`rounded-lg border px-4 py-3 text-sm font-semibold transition-all ${
                        role === option.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-300 text-gray-600 hover:border-blue-300'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Enter your full name" 
                    required 
                    value={fullName} 
                    onChange={e => setFullName(e.target.value)} 
                    className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                  />
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="tel"
                      placeholder="Enter contact number"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                    />
                  </div>
                </div>

                {role === 'patient' ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <select
                            required
                            value={gender}
                            onChange={e => setGender(e.target.value)}
                            className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all appearance-none"
                          >
                            <option value="" disabled>Select Gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                        <div className="relative">
                          <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <input
                            type="date"
                            required
                            value={dateOfBirth}
                            onChange={e => setDateOfBirth(e.target.value)}
                            className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
                        <div className="relative">
                          <Activity className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <input
                            type="number"
                            placeholder="e.g. 70"
                            min="1"
                            max="300"
                            step="0.1"
                            value={weight}
                            onChange={e => setWeight(e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Height (cm)</label>
                        <div className="relative">
                          <Ruler className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <input
                            type="number"
                            placeholder="e.g. 175"
                            min="1"
                            max="300"
                            step="0.1"
                            value={height}
                            onChange={e => setHeight(e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Clinical Stage (Optional)</label>
                      <div className="relative">
                        <Activity className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <select
                          value={clinicalStage}
                          onChange={e => setClinicalStage(e.target.value)}
                          className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all appearance-none"
                        >
                          <option value="" disabled>Select Clinical Stage</option>
                          <option value="Not Diagnosed">Not Diagnosed</option>
                          <option value="Stage 1">Stage 1</option>
                          <option value="Stage 2">Stage 2</option>
                          <option value="Stage 3">Stage 3</option>
                          <option value="Stage 4">Stage 4</option>
                          <option value="Stage 5">Stage 5</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Doctor ID / Registration No.</label>
                        <div className="relative">
                          <IdCard className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Enter doctor ID"
                            value={doctorIdentifier}
                            onChange={e => setDoctorIdentifier(e.target.value)}
                            className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <input
                            type="number"
                            placeholder="e.g. 42"
                            min="21"
                            max="100"
                            value={doctorAge}
                            onChange={e => setDoctorAge(e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <select
                            value={doctorGender}
                            onChange={e => setDoctorGender(e.target.value)}
                            className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all appearance-none"
                          >
                            <option value="" disabled>Select Gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Years of Experience</label>
                        <div className="relative">
                          <Briefcase className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <input
                            type="number"
                            placeholder="e.g. 12"
                            min="0"
                            max="60"
                            value={yearsExperience}
                            onChange={e => setYearsExperience(e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Hospital / Clinic</label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Enter hospital or clinic"
                          value={hospital}
                          onChange={e => setHospital(e.target.value)}
                          className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Qualification</label>
                      <div className="relative">
                        <GraduationCap className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="MBBS, MD Neurology"
                          value={qualification}
                          onChange={e => setQualification(e.target.value)}
                          className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Specialties</label>
                      <div className="relative">
                        <BriefcaseMedical className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Movement Disorders, Tele-neurology"
                          value={specialties}
                          onChange={e => setSpecialties(e.target.value)}
                          className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">Separate specialties with commas. Doctor accounts stay pending until approved by an admin.</p>
                    </div>
                  </>
                )}
              </motion.div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input 
                  type="email" 
                  placeholder="Enter your email" 
                  required 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input 
                  type="password" 
                  placeholder="Enter your password" 
                  required 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  className="w-full bg-white text-gray-900 pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                />
              </div>
            </div>
          
            {!isLogin && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start space-x-3 p-4 bg-blue-50 rounded-lg border border-blue-100"
              >
                <input 
                  type="checkbox" 
                  id="consent" 
                  required 
                  checked={consent} 
                  onChange={(e) => setConsent(e.target.checked)} 
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="consent" className="text-sm text-gray-700 leading-relaxed">
                  I consent to the use of my camera/microphone and the processing of my medical data for analysis, as described in the <a href="#" className="underline text-blue-600 hover:text-blue-700 font-medium">Privacy Policy</a>.
                </label>
              </motion.div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center space-x-2 text-red-700 bg-red-50 p-3 rounded-lg border border-red-200"
              >
                <AlertCircle size={20} className="flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </motion.div>
            )}
            {message && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center space-x-2 text-green-700 bg-green-50 p-3 rounded-lg border border-green-200"
              >
                <CheckCircle size={20} className="flex-shrink-0" />
                <p className="text-sm">{message}</p>
              </motion.div>
            )}

            <button 
              type="submit" 
              disabled={loading} 
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold py-3 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <LoaderCircle className="animate-spin h-5 w-5" />
              ) : (
                <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
              )}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">
                  {isLogin ? "Don't have an account?" : 'Already have an account?'}
                </span>
              </div>
            </div>
            <button 
              onClick={() => { setIsLogin(!isLogin); setError(null); setMessage(null); setRole('patient'); }} 
              className="mt-4 w-full text-blue-600 hover:text-blue-700 font-medium py-2 rounded-lg hover:bg-blue-50 transition-colors"
            >
              {isLogin ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </div>
        
        {/* Footer */}
        <p className="text-center text-sm text-gray-600 mt-6">
          By continuing, you agree to our{' '}
          <a href="#" className="text-blue-600 hover:text-blue-700 underline">Terms of Service</a>
          {' '}and{' '}
          <a href="#" className="text-blue-600 hover:text-blue-700 underline">Privacy Policy</a>
        </p>
      </motion.div>
    </div>
  );
};

export default Auth;
