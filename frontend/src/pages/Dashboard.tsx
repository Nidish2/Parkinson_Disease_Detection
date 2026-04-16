import { useEffect, useState } from 'react';
import Card from '../components/Card';
import Chart from '../components/Chart';
import DigitalTwinCard from '../components/DigitalTwinCard';
import { Activity, FileText, BarChart, LoaderCircle, TrendingUp, PieChart, List, HeartPulse, Droplets, ArrowRight, CalendarDays, Video, ClipboardList, MessageSquare } from 'lucide-react';
import { mongodb } from '../lib/mongodbClient';
import { TEST_QUERY_TIMEOUT_MS } from '../services/testPersistence';
import { useAuth } from '../hooks/useAuth';
import { Test } from '../types/database';
import { Link } from 'react-router-dom';
import { getLatestByModality } from '../services/fusionScoreService';
import { ensureUnifiedReport, getAppointments, getReports } from '../services/healthcareApi';
import type { AppointmentRecord, UnifiedReport } from '../types/healthcare';
import { collapseAppointments, isRejectedAppointment, normalizeAppointmentStatus } from '../utils/appointments';

const PROFILE_KEY = 'pd_nutrition_profile';
const LOGS_KEY = 'pd_nutrition_logs';
const BMI_HISTORY_KEY = 'pd_bmi_history';
const LOCAL_APPOINTMENTS_KEY = 'local_appointments';

const classifyBmi = (bmi: number) => {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
};

const toScore10 = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (value > 1) return Math.max(0, Math.min(10, value));
  return Math.max(0, Math.min(10, value * 10));
};

const deriveRiskScore = (test: Test): number | null => {
  const result: any = test.result || {};

  // Preferred direct values
  const directRiskScore = toScore10(result?.riskScore);
  if (directRiskScore !== null) return directRiskScore;

  // Voice payload variants
  const probability = toScore10(result?.probability);
  if (probability !== null) return probability;

  const probabilityOfParkinsons = toScore10(result?.probabilityOfParkinsons);
  if (probabilityOfParkinsons !== null) return probabilityOfParkinsons;

  // Handwriting payload often has probabilities.Parkinsons
  const probabilityFromMap = toScore10(result?.probabilities?.Parkinsons);
  if (probabilityFromMap !== null) return probabilityFromMap;

  // Final fallback based on label + confidence
  if (typeof result?.confidence === 'number') {
    const confidence01 = Math.max(0, Math.min(1, result.confidence));
    if (result?.label === 'Parkinsons') return confidence01 * 10;
    if (result?.label === 'Healthy') return (1 - confidence01) * 10;
  }

  return null;
};

const getRiskSeries = (tests: Test[]) => tests
  .map((t) => {
    const score = deriveRiskScore(t);
    if (score === null) return null;
    return {
      date: new Date(t.created_at).toLocaleDateString(),
      score: Number(score.toFixed(1)),
      createdAt: new Date(t.created_at).getTime(),
    };
  })
  .filter((item): item is { date: string; score: number; createdAt: number } => Boolean(item))
  .sort((a, b) => a.createdAt - b.createdAt);

const getDistribution = (tests: Test[]) => tests.reduce((acc, test) => {
  acc[test.test_type] = (acc[test.test_type] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

const toIndicatorScore = (score: number | null, fallback: number) => {
  if (score === null) return fallback;
  return Math.max(0, Math.min(100, Math.round(score * 10)));
};

const getRiskScoreChartOption = (tests: Test[]) => {
  const chartData = getRiskSeries(tests);

  if (chartData.length < 2) {
      return null; // Return null to indicate not enough data for a trend line
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1f2937',
      borderWidth: 0,
      textStyle: { color: '#F9FAFB' },
    },
    xAxis: {
      type: 'category',
      data: chartData.map(d => d.date),
      axisLine: { lineStyle: { color: '#9CA3AF' } },
      axisLabel: { color: '#6B7280', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 10,
      axisLine: { lineStyle: { color: '#9CA3AF' } },
      splitLine: { lineStyle: { color: '#E5E7EB' } },
      axisLabel: { color: '#6B7280', fontSize: 11 },
    },
    series: [{
      name: 'Risk Score',
      type: 'line',
      smooth: true,
      data: chartData.map(d => d.score),
      symbol: 'circle',
      symbolSize: 8,
      lineStyle: { width: 3, color: '#5D7052' },
      itemStyle: { color: '#5D7052' }, // Moss Green
      areaStyle: {
          color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: 'rgba(93, 112, 82, 0.4)' }, { offset: 1, color: 'rgba(93, 112, 82, 0)' }]
          }
      }
    }],
    grid: { left: '6%', right: '4%', top: '10%', bottom: '10%', containLabel: true },
  };
};

const getDistributionChartOption = (tests: Test[]) => {
    const distribution = getDistribution(tests);

    return {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item' },
        legend: { show: false },
        series: [{
            name: 'Test Types',
            type: 'pie',
            radius: ['55%', '80%'],
            center: ['50%', '52%'],
            avoidLabelOverlap: true,
            label: { show: true, position: 'inner', formatter: '{c}', color: 'white', fontWeight: 'bold' },
            emphasis: {
                itemStyle: {
                   shadowBlur: 10,
                   shadowOffsetX: 0,
                   shadowColor: 'rgba(0, 0, 0, 0.2)'
                }
            },
            data: Object.entries(distribution).map(([name, value]) => ({ value, name })),
            color: ['#5D7052', '#C18C5D', '#A85448', '#4A4A40', '#78786C'] // Earthy palette
        }],
        graphic: [
          {
            type: 'text',
            left: 'center',
            top: '45%',
            style: {
              text: String(tests.length),
              fill: '#1F2937',
              fontSize: 26,
              fontWeight: 700,
              textAlign: 'center',
            },
          },
          {
            type: 'text',
            left: 'center',
            top: '54%',
            style: {
              text: 'Total',
              fill: '#6B7280',
              fontSize: 12,
              fontWeight: 600,
              textAlign: 'center',
            },
          },
        ],
    };
};

const Dashboard = () => {
  const { user, loading: authLoading } = useAuth();
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [stats, setStats] = useState({
    totalTests: 0,
    avgRisk: 'N/A',
    lastTestDate: 'N/A',
  });
  const [timeframe, setTimeframe] = useState<'all' | '30d' | '5'>('all');
  const [reports, setReports] = useState<UnifiedReport[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);

  const calculateStats = (testsData: Test[], tf: 'all' | '30d' | '5' = timeframe) => {
    if (!testsData || testsData.length === 0) {
        setStats({ totalTests: 0, avgRisk: 'N/A', lastTestDate: 'N/A' });
        return;
    };

    const totalTests = testsData.length;
    
    const lastTestDate = new Date(testsData[0].created_at);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - lastTestDate.getTime()) / (1000 * 3600 * 24));
    const lastTestDateStr = diffDays === 0 ? 'Today' : `${diffDays}d ago`;

    let filteredTests = testsData;
    if (tf === '30d') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filteredTests = testsData.filter(t => new Date(t.created_at) >= thirtyDaysAgo);
    } else if (tf === '5') {
      filteredTests = testsData.slice(0, 5);
    }

    const testsWithRisk = filteredTests
      .map((t) => deriveRiskScore(t))
      .filter((score): score is number => score !== null);
      
    const avgRisk = testsWithRisk.length > 0 
        ? (testsWithRisk.reduce((acc, score) => acc + score, 0) / testsWithRisk.length).toFixed(1)
        : 'N/A';
    
    setStats({ totalTests, avgRisk, lastTestDate: lastTestDateStr });
  };

  const fetchTests = async (silent = false) => {
    if (!user) {
        setLoading(false);
        setInitialLoadComplete(true);
        return;
    }

    // Only show spinner on initial load, not on refreshes
    if (!silent && !initialLoadComplete) {
        setLoading(true);
    }
    console.log('fetchTests - starting to fetch tests for user:', user.id);

    try {
      // Try MongoDB with short timeout
      const queryPromise = mongodb
        .from('tests')
        .select('*')
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false });
      
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), TEST_QUERY_TIMEOUT_MS),
      );

      let mongodbTests: any[] = [];
      
      try {
        const { data, error } = await Promise.race([queryPromise, timeoutPromise]) as any;
        if (!error && data) {
          mongodbTests = data;
          console.log('✅ Loaded tests from MongoDB:', mongodbTests.length);
        }
      } catch (dbError) {
        console.warn('⚠️ MongoDB not available, loading from localStorage');
      }

      // Load local tests (voice and others)
      const localTests = [
        ...JSON.parse(localStorage.getItem('local_tests') || '[]'),
        ...JSON.parse(localStorage.getItem('local_test_results') || '[]'),
      ].filter((t: any) => t.patient_id === user.id);
      console.log('✅ Loaded tests from localStorage:', localTests.length);

      // Merge and deduplicate
      const allTests = [...localTests, ...mongodbTests];
      const uniqueTests = Array.from(new Map(allTests.map(t => [t.id, t])).values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setTests(uniqueTests);
      calculateStats(uniqueTests);
      
      // Cache data in localStorage for instant load next time
      localStorage.setItem('dashboard_cache', JSON.stringify({
        tests: uniqueTests,
        timestamp: Date.now()
      }));
      
      console.log('📊 Total tests displayed:', uniqueTests.length);
    } catch (error) {
      console.error('Failed to fetch tests:', error);
      setTests([]);
      calculateStats([]);
    } finally {
      console.log('fetchTests - setting loading to false');
      setLoading(false);
      setInitialLoadComplete(true);
    }
  };

  const fetchWorkflowData = async () => {
    if (!user || user.role !== 'patient') {
      setReports([]);
      setAppointments([]);
      return;
    }

    try {
      const [reportData, appointmentData] = await Promise.all([
        getReports().catch(() => []),
        getAppointments().catch(() => []),
      ]);

      let localAppointments: AppointmentRecord[] = [];
      try {
        localAppointments = (JSON.parse(localStorage.getItem(LOCAL_APPOINTMENTS_KEY) || '[]') as AppointmentRecord[])
          .filter((appointment) => appointment.patient_id === user.id);
      } catch (error) {
        console.error('Failed to read local appointment cache:', error);
      }

      const byId = new Map<string, AppointmentRecord>();
      [...localAppointments, ...appointmentData].forEach((appointment) => {
        if (appointment?.id) {
          byId.set(appointment.id, appointment);
        }
      });

      const mergedAppointments = collapseAppointments(Array.from(byId.values()));

      setReports(reportData);
      setAppointments(mergedAppointments);
    } catch (error) {
      console.error('Failed to fetch patient workflow data:', error);
      setReports([]);
      setAppointments([]);
    }
  };

  useEffect(() => {
    const bootstrapReport = async () => {
      if (!user || user.role !== 'patient' || reports.length > 0) return;
      const latestFusionTest = tests.find((test) => test.test_type === 'fusion');
      if (!latestFusionTest) return;

      try {
        await ensureUnifiedReport({ testId: latestFusionTest.id });
        const refreshedReports = await getReports().catch(() => []);
        setReports(refreshedReports);
      } catch (error) {
        console.error('Failed to bootstrap unified report from fusion test:', error);
      }
    };

    bootstrapReport();
  }, [reports.length, tests, user]);

  useEffect(() => {
    console.log('Dashboard useEffect - authLoading:', authLoading, 'user:', user);
    
    if (authLoading) {
        return;
    }

    if (!user) {
        console.log('No user - setting loading to false');
        setTests([]);
        calculateStats([]);
        setLoading(false);
        return;
    }

    console.log('User exists - fetching data');
    
    // Load from cache immediately for instant display
    const cachedData = localStorage.getItem('dashboard_cache');
    if (cachedData) {
      try {
        const { tests: cachedTests, timestamp } = JSON.parse(cachedData);
        // Use cache if less than 30 seconds old
        if (Date.now() - timestamp < 30000) {
          console.log('📦 Loading from cache for instant display');
          setTests(cachedTests);
          calculateStats(cachedTests);
          setLoading(false);
          setInitialLoadComplete(true);
          // Still fetch in background to update
          fetchTests(true);
          fetchWorkflowData();
          return;
        }
      } catch (e) {
        console.log('Cache parse error:', e);
      }
    }
    
    // Call fetchTests immediately
    fetchTests();
    fetchWorkflowData();
    
    // Setup realtime subscriptions
    const channel = mongodb.channel('realtime-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tests', filter: `patient_id=eq.${user.id}`},
        (payload: unknown) => {
          console.log('Realtime change received!', payload);
          fetchTests();
        })
      .subscribe();

    // Poll localStorage for new tests every 5 seconds for real-time updates (silent)
    const pollInterval = setInterval(() => {
      console.log('🔄 Polling for new tests...');
      fetchTests(true); // Silent refresh
      fetchWorkflowData();
    }, 5000);

    // Listen for storage events from other tabs/windows
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'local_tests' || e.key === 'local_test_results') {
        console.log('📢 Storage change detected, refreshing tests...');
        fetchTests(true); // Silent refresh
      }
      if (e.key === LOCAL_APPOINTMENTS_KEY) {
        fetchWorkflowData();
      }
    };

    const handleWindowFocus = () => {
      fetchTests(true);
      fetchWorkflowData();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
        mongodb.removeChannel(channel);
        clearInterval(pollInterval);
        window.removeEventListener('storage', handleStorageChange);
        window.removeEventListener('focus', handleWindowFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  if (authLoading || loading) {
    return <div className="flex h-full w-full items-center justify-center"><LoaderCircle className="animate-spin h-8 w-8 text-primary" /></div>;
  }

  if (!user) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center space-y-4 text-center">
        <h2 className="text-2xl font-semibold">Sign in to view your dashboard</h2>
        <p className="text-muted-foreground max-w-md">
          We couldn&apos;t find an active session. Please sign in again to access your personal analytics and test history.
        </p>
        <Link
          to="/login"
          className="rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground hover:scale-105 shadow-soft transition-all duration-300 active:scale-95"
        >
          Go to Sign In
        </Link>
      </div>
    );
  }

  const riskSeries = getRiskSeries(tests);
  const latestRisk = riskSeries.length ? riskSeries[riskSeries.length - 1].score : null;
  const previousRisk = riskSeries.length > 1 ? riskSeries[riskSeries.length - 2].score : null;
  const riskDelta = latestRisk !== null && previousRisk !== null
    ? Number((latestRisk - previousRisk).toFixed(1))
    : null;
  const trendDirection = riskDelta === null ? 'Stable' : riskDelta > 0 ? 'Up' : riskDelta < 0 ? 'Down' : 'Stable';

  const distribution = getDistribution(tests);
  const latestReport = reports[0] || null;
  const nonRejectedAppointments = appointments.filter((appointment) => !isRejectedAppointment(appointment));
  const latestReportAppointment = latestReport
    ? nonRejectedAppointments.find((appointment) => appointment.report_id === latestReport.id)
    : null;
  const prescriptionAppointment = nonRejectedAppointments.find((appointment) => appointment.report?.prescription?.length);
  const upcomingAppointment = latestReportAppointment
    || prescriptionAppointment
    || [...nonRejectedAppointments]
      .sort((a, b) => new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime())
      .find((appointment) => normalizeAppointmentStatus(appointment.status) !== 'completed')
    || nonRejectedAppointments[0]
    || null;
  const distributionEntries = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const distributionPalette = ['#5D7052', '#C18C5D', '#A85448', '#4A4A40', '#78786C'];
  const latestByModality = getLatestByModality(tests);
  const digitalTwinMetrics = {
    handTremor: toIndicatorScore(latestByModality.spiral ? deriveRiskScore(latestByModality.spiral) : null, 65),
    voiceStability: toIndicatorScore(latestByModality.speech ? deriveRiskScore(latestByModality.speech) : null, 50),
    drawingAccuracy: toIndicatorScore(latestByModality.wave ? deriveRiskScore(latestByModality.wave) : null, 70),
  };

  const nutritionProfile = (() => {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    } catch {
      return {};
    }
  })();

  const nutritionLogs = (() => {
    try {
      return JSON.parse(localStorage.getItem(LOGS_KEY) || '[]') as Array<{ score?: number; hydrationLiters?: number }>;
    } catch {
      return [];
    }
  })();

  const bmiHistory = (() => {
    try {
      return JSON.parse(localStorage.getItem(BMI_HISTORY_KEY) || '[]') as Array<{ bmi?: number }>;
    } catch {
      return [];
    }
  })();

  const latestBmi = typeof bmiHistory?.[0]?.bmi === 'number' ? bmiHistory[0].bmi : null;
  const latestBmiClass = latestBmi !== null ? classifyBmi(latestBmi) : 'N/A';
  const latestNutritionScore = typeof nutritionLogs?.[0]?.score === 'number' ? nutritionLogs[0].score : null;
  const latestHydration = typeof nutritionLogs?.[0]?.hydrationLiters === 'number' ? nutritionLogs[0].hydrationLiters : null;
  const profileCompleteness = ['age', 'weightKg', 'heightCm', 'dietaryPreference']
    .filter((key) => Boolean((nutritionProfile as any)[key])).length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="rounded-organic-1 bg-background/70 dark:bg-accent/35">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Total Tests</p>
            <div className="p-2 bg-primary/10 rounded-2xl"><BarChart className="h-5 w-5 text-primary" /></div>
          </div>
          <p className="text-4xl font-serif font-bold mt-3 text-foreground">{stats.totalTests}</p>
        </Card>
        <Card className="rounded-organic-2 bg-background/70 dark:bg-accent/35">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Average Risk</p>
            <div className="flex items-center gap-3">
              <select 
                value={timeframe} 
                onChange={(e) => {
                  const val = e.target.value as 'all' | '30d' | '5';
                  setTimeframe(val);
                  calculateStats(tests, val);
                }}
                className="text-[11px] font-semibold tracking-wider text-muted-foreground bg-background/50 border border-border/50 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-background transition-colors"
                title="Timeframe for Average Risk Score"
              >
                <option value="all">All Time</option>
                <option value="30d">Last 30 Days</option>
                <option value="5">Last 5 Tests</option>
              </select>
              <div className="p-2 bg-secondary/10 rounded-2xl"><Activity className="h-5 w-5 text-secondary" /></div>
            </div>
          </div>
          <p className="text-4xl font-serif font-bold mt-3 text-secondary">{stats.avgRisk} <span className="text-xl text-muted-foreground font-sans">/ 10</span></p>
        </Card>
        <Card className="rounded-organic-3 bg-background/70 dark:bg-accent/35">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Last Test</p>
            <div className="p-2 bg-accent-foreground/5 rounded-2xl"><FileText className="h-5 w-5 text-accent-foreground" /></div>
          </div>
          <p className="text-3xl font-serif font-bold mt-3 text-foreground">{stats.lastTestDate}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="rounded-organic-4 bg-background/70 dark:bg-accent/35">
          <div className="flex items-start justify-between gap-4 border-b border-border/30 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-primary/10">
                <ClipboardList className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-serif text-2xl font-bold text-foreground">Latest Unified Report</h3>
                <p className="text-sm text-muted-foreground">AI results and doctor review stay together in one report.</p>
              </div>
            </div>
            <Link
              to="/comprehensive-screening"
              className="inline-flex items-center gap-2 rounded-full border border-border/40 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
            >
              Update AI Report
            </Link>
          </div>
          {latestReport ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Status</p>
                  <p className="text-xl font-serif font-bold text-foreground mt-1 capitalize">{latestReport.status}</p>
                </div>
                <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">AI Risk</p>
                  <p className="text-xl font-serif font-bold text-foreground mt-1">{latestReport.aiResults?.summary?.riskScore?.toFixed?.(1) ?? 'N/A'} / 10</p>
                </div>
                <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Doctor Notes</p>
                  <p className="text-xl font-serif font-bold text-foreground mt-1">{latestReport.doctorNotes ? 'Available' : 'Pending'}</p>
                </div>
              </div>
              {latestReport.prescription?.length > 0 && (
                <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Prescription</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {latestReport.prescription.map((item, index) => (
                      <span key={`${item}-${index}`} className="rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Summary</p>
                <p className="text-sm text-foreground mt-2 leading-relaxed">
                  {latestReport.doctorNotes || latestReport.aiResults?.fusion?.recommendations?.[0] || 'Your latest AI report is ready for review. Book an appointment to get a doctor prescription added to the same report.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={`/reports/${latestReport.id}`}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  View Report
                </Link>
                <Link
                  to="/consult"
                  className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                >
                  Book Appointment
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-border/60 bg-background/40 p-6 text-center">
              <p className="font-serif text-xl font-bold text-foreground">No unified report yet</p>
              <p className="text-sm text-muted-foreground mt-2">Save your comprehensive AI screening first, then book a doctor review.</p>
              <Link
                to="/comprehensive-screening"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors mt-4"
              >
                Create AI Report
              </Link>
            </div>
          )}
        </Card>

        <Card className="rounded-organic-1 bg-background/70 dark:bg-accent/35">
          <div className="flex items-start justify-between gap-4 border-b border-border/30 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-secondary/10">
                <CalendarDays className="h-6 w-6 text-secondary" />
              </div>
              <div>
                <h3 className="font-serif text-2xl font-bold text-foreground">Appointments & Calls</h3>
                <p className="text-sm text-muted-foreground">Move from AI screening to doctor consultation without leaving the same workflow.</p>
              </div>
            </div>
          </div>
          {upcomingAppointment ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Next Appointment</p>
                <p className="text-xl font-serif font-bold text-foreground mt-1">{upcomingAppointment.doctorDetails?.full_name || upcomingAppointment.doctor_name || 'Assigned Doctor'}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {new Date(upcomingAppointment.appointment_date).toLocaleDateString()} at {upcomingAppointment.appointment_time}
                </p>
                <p className="text-sm text-muted-foreground mt-1 capitalize">
                  {upcomingAppointment.consultation_type} consultation • {upcomingAppointment.status}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {upcomingAppointment.call_url && upcomingAppointment.status === 'accepted' && (
                  <a
                    href={upcomingAppointment.call_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <Video className="h-4 w-4" /> Join Call
                  </a>
                )}
                {upcomingAppointment.status === 'accepted' ? (
                  <Link
                    to={`/appointments/${upcomingAppointment.id}/communication`}
                    className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <MessageSquare className="h-4 w-4" /> Chat
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border border-border/40 px-5 py-2.5 text-sm font-semibold text-muted-foreground">
                    <MessageSquare className="h-4 w-4" /> Waiting for doctor
                  </span>
                )}
                {upcomingAppointment.report_id && (
                  <Link
                    to={`/reports/${upcomingAppointment.report_id}`}
                    className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                  >
                    Open Linked Report
                  </Link>
                )}
                <Link
                  to="/consult"
                  className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                >
                  Book Appointment
                </Link>
              </div>
              {upcomingAppointment.report?.prescription?.length ? (
                <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Latest Prescription</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {upcomingAppointment.report.prescription.map((item, index) => (
                      <span key={`${item}-${index}`} className="rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-border/60 bg-background/40 p-6 text-center">
              <p className="font-serif text-xl font-bold text-foreground">No appointments scheduled</p>
              <p className="text-sm text-muted-foreground mt-2">Choose an approved doctor and link your latest report to start clinical review.</p>
              <Link
                to="/consult"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors mt-4"
              >
                Book Appointment
              </Link>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3 h-[28rem] rounded-organic-4 bg-background/70 dark:bg-accent/35">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="font-serif text-xl font-bold flex items-center text-foreground"><TrendingUp size={20} className="mr-2 text-primary" /> Risk Score Trend</h3>
                <p className="text-sm text-muted-foreground font-medium mt-1">Recent progression across your completed screening tests.</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest Risk</p>
                <p className="text-2xl font-serif font-bold text-primary">{latestRisk !== null ? `${latestRisk.toFixed(1)}/10` : 'N/A'}</p>
              </div>
            </div>
            {tests.length > 0 && getRiskScoreChartOption(tests) ? (
                <>
                  <div className="h-[18rem]">
                    <Chart option={getRiskScoreChartOption(tests)} />
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div className="rounded-2xl bg-background/60 border border-border/40 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Trend</p>
                      <p className="text-lg font-bold text-foreground">{trendDirection}</p>
                    </div>
                    <div className="rounded-2xl bg-background/60 border border-border/40 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Delta</p>
                      <p className="text-lg font-bold text-foreground">{riskDelta === null ? 'N/A' : `${riskDelta > 0 ? '+' : ''}${riskDelta.toFixed(1)}`}</p>
                    </div>
                    <div className="rounded-2xl bg-background/60 border border-border/40 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Data Points</p>
                      <p className="text-lg font-bold text-foreground">{riskSeries.length}</p>
                    </div>
                  </div>
                </>
            ) : (
                <div className="h-full w-full flex flex-col items-center justify-center -mt-8">
                    <div className="w-16 h-16 bg-muted/50 rounded-[2rem] flex items-center justify-center mb-4">
                        <TrendingUp size={28} className="text-muted-foreground" />
                    </div>
                    <p className="text-foreground font-serif font-bold text-lg">Not Enough Data</p>
                    <p className="text-muted-foreground text-sm font-medium mt-1">Complete at least 2 tests to visualize your changing risk over time.</p>
                </div>
            )}
        </Card>
        <Card className="lg:col-span-2 h-[28rem] rounded-organic-1 bg-background/70 dark:bg-accent/35">
            <div className="mb-3">
              <h3 className="font-serif text-xl font-bold flex items-center text-foreground"><PieChart size={20} className="mr-2 text-primary" /> Test Type Distribution</h3>
              <p className="text-sm text-muted-foreground font-medium mt-1">Modality balance across your latest saved screenings.</p>
            </div>
            {tests.length > 0 ? (
                <div className="h-[22rem] grid grid-cols-5 gap-2 items-center">
                  <div className="col-span-3 h-full">
                    <Chart option={getDistributionChartOption(tests)} />
                  </div>
                  <div className="col-span-2 space-y-2">
                    {distributionEntries.map(([type, count], index) => {
                      const pct = Math.round((count / tests.length) * 100);
                      return (
                        <div key={type} className="rounded-xl border border-border/40 bg-background/60 p-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold capitalize text-foreground flex items-center gap-2">
                              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: distributionPalette[index % distributionPalette.length] }} />
                              {type}
                            </span>
                            <span className="font-semibold text-muted-foreground">{pct}%</span>
                          </div>
                          <p className="text-base font-bold text-foreground mt-0.5">{count}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
            ) : (
                <div className="h-full w-full flex flex-col items-center justify-center -mt-8">
                    <div className="w-16 h-16 bg-primary/10 rounded-[2rem] flex items-center justify-center mb-4">
                        <PieChart size={28} className="text-primary" />
                    </div>
                    <p className="text-foreground font-serif font-bold text-lg">No Tests Taken</p>
                    <p className="text-muted-foreground text-sm font-medium mt-1 text-center px-4">Your analysis modalities will appear here once you take your first test.</p>
                </div>
            )}
        </Card>
      </div>

      <DigitalTwinCard
        handTremor={digitalTwinMetrics.handTremor}
        voiceStability={digitalTwinMetrics.voiceStability}
        drawingAccuracy={digitalTwinMetrics.drawingAccuracy}
      />

      <Card className="rounded-organic-2 bg-background/70 dark:bg-accent/35">
        <div className="flex justify-between items-center mb-6 border-b border-border/30 pb-4">
            <h3 className="font-serif text-lg font-bold flex items-center text-foreground"><List size={18} className="mr-2 text-primary" /> Recent Tests</h3>
            <Link to="/history" className="text-sm font-semibold text-primary/80 hover:text-primary transition-colors">View All</Link>
        </div>
        <div className="space-y-3">
          {tests.slice(0, 3).map((item, index) => {
            const itemRiskScore = deriveRiskScore(item);
            return (
            <div key={`${item.id}-${index}`} className="flex items-center justify-between p-4 bg-background/50 backdrop-blur-sm border border-border/30 rounded-2xl hover:bg-muted/30 transition-all duration-300">
              <div className="flex items-center space-x-4">
                <div className="p-2 bg-primary/5 rounded-xl"><FileText className="h-5 w-5 text-primary" /></div>
                <div>
                  <div className="font-serif font-bold text-foreground capitalize">{item.test_type} Test</div>
                  <div className="text-xs text-muted-foreground font-medium">{new Date(item.created_at).toLocaleDateString()}</div>
                </div>
              </div>
              <span className="text-xs font-bold text-primary bg-primary/10 px-4 py-1.5 rounded-full uppercase tracking-wide">
                {itemRiskScore !== null ? `Risk: ${itemRiskScore.toFixed(1)}/10` : 'Processing...'}
              </span>
            </div>
          )})}
          {tests.length === 0 && <p className="text-center text-muted-foreground py-8">You haven't performed any tests yet.</p>}
        </div>
      </Card>

      <Card className="rounded-organic-1 bg-background/70 dark:bg-accent/35">
        <div className="flex justify-between items-center mb-6 border-b border-border/30 pb-4">
            <div>
              <h3 className="font-serif text-lg font-bold flex items-center text-foreground"><ClipboardList size={18} className="mr-2 text-secondary" /> Test Histories & Doctor Feedback</h3>
              <p className="text-sm text-muted-foreground mt-1">All reviewed tests with doctor notes and recommendations</p>
            </div>
        </div>
        <div className="space-y-3">
          {reports.map((report, index) => (
            <div key={`${report.id}-${index}`} className="rounded-2xl border border-border/30 bg-background/50 p-4 hover:bg-muted/20 transition-all duration-300">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-grow space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full">{report.status}</span>
                    <p className="text-sm text-muted-foreground">{new Date(report.created_at).toLocaleDateString()}</p>
                  </div>
                  {report.aiResults?.fusion?.summary && (
                    <p className="text-sm text-foreground font-medium">{report.aiResults.fusion.summary}</p>
                  )}
                  {report.doctorNotes && (
                    <div className="mt-2 p-3 rounded-xl bg-secondary/5 border border-secondary/20">
                      <p className="text-xs font-bold text-secondary mb-1">Doctor Feedback:</p>
                      <p className="text-sm text-foreground">{report.doctorNotes}</p>
                    </div>
                  )}
                  {report.prescription?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {report.prescription.map((item, idx) => (
                        <span key={`${report.id}-rx-${idx}`} className="text-xs font-semibold bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Link
                  to={`/reports/${report.id}`}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
                >
                  View Full Report
                </Link>
              </div>
            </div>
          ))}
          {reports.length === 0 && (
            <div className="text-center py-6 text-muted-foreground">
              <p className="font-medium">No reviewed reports yet</p>
              <p className="text-sm mt-1">Book a doctor consultation to get your report reviewed and receive feedback</p>
            </div>
          )}
        </div>
      </Card>

      <Card className="rounded-organic-1 bg-background/70 dark:bg-accent/35">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-5 border-b border-border/30 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-primary/15">
              <HeartPulse className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-serif text-2xl font-bold text-foreground">Nutrition Summary</h3>
              <p className="text-sm text-muted-foreground">Quick overview. Open Nutrition Planner for full diet guidance and tracking.</p>
            </div>
          </div>
          <Link
            to="/nutrition-planner"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
          >
            Open Planner <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-border/40 bg-background/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Latest BMI</p>
            <p className="text-2xl font-serif font-bold text-foreground mt-1">{latestBmi !== null ? latestBmi.toFixed(1) : 'N/A'}</p>
            <p className="text-xs text-muted-foreground mt-1">{latestBmiClass}</p>
          </div>

          <div className="rounded-2xl border border-border/40 bg-background/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Nutrition Score</p>
            <p className="text-2xl font-serif font-bold text-foreground mt-1">{latestNutritionScore !== null ? `${latestNutritionScore}/100` : 'N/A'}</p>
            <p className="text-xs text-muted-foreground mt-1">Last tracked meal quality</p>
          </div>

          <div className="rounded-2xl border border-border/40 bg-background/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1"><Droplets className="h-3.5 w-3.5" /> Hydration</p>
            <p className="text-2xl font-serif font-bold text-foreground mt-1">{latestHydration !== null ? `${latestHydration}L` : 'N/A'}</p>
            <p className="text-xs text-muted-foreground mt-1">Daily intake snapshot</p>
          </div>

          <div className="rounded-2xl border border-border/40 bg-background/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Profile Setup</p>
            <p className="text-2xl font-serif font-bold text-foreground mt-1">{profileCompleteness}/4</p>
            <p className="text-xs text-muted-foreground mt-1">Complete details in planner</p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Dashboard;
