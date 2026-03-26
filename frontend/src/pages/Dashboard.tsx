import { useEffect, useState } from 'react';
import Card from '../components/Card';
import Chart from '../components/Chart';
import { Activity, FileText, BarChart, LoaderCircle, TrendingUp, PieChart, List, Calendar, Clock, FileDown } from 'lucide-react';
import { mongodb } from '../lib/mongodbClient';
import { useAuth } from '../hooks/useAuth';
import { Test, Appointment } from '../types/database';
import { Link } from 'react-router-dom';
import { getPrescriptionUrl } from '../utils/reportUtils';

const getRiskScoreChartOption = (tests: Test[]) => {
  const chartData = tests
    .filter(t => (t.result as any)?.riskScore)
    .map(t => ({
      date: new Date(t.created_at).toLocaleDateString(),
      score: (t.result as any).riskScore,
    }))
    .reverse(); // oldest to newest

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: chartData.map(d => d.date),
      axisLine: { lineStyle: { color: '#9CA3AF' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 10,
      axisLine: { lineStyle: { color: '#9CA3AF' } },
      splitLine: { lineStyle: { color: '#E5E7EB' } },
    },
    series: [{
      name: 'Risk Score',
      type: 'line',
      smooth: true,
      data: chartData.map(d => d.score),
      itemStyle: { color: '#2563EB' },
      areaStyle: {
          color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: 'rgba(37, 99, 235, 0.5)' }, { offset: 1, color: 'rgba(37, 99, 235, 0)' }]
          }
      }
    }],
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
  };
};

const getDistributionChartOption = (tests: Test[]) => {
    const distribution = tests.reduce((acc, test) => {
        acc[test.test_type] = (acc[test.test_type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item' },
        legend: {
            orient: 'vertical',
            left: 'left',
            textStyle: { color: '#4B5563' }
        },
        series: [{
            name: 'Test Types',
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: false,
            label: { show: false },
            emphasis: {
                label: { show: true, fontSize: '20', fontWeight: 'bold', color: '#1F2937' }
            },
            data: Object.entries(distribution).map(([name, value]) => ({ value, name })),
            color: ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE']
        }]
    };
};

const Dashboard = () => {
  const { user, loading: authLoading } = useAuth();
  const [tests, setTests] = useState<Test[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [stats, setStats] = useState({
    totalTests: 0,
    avgRisk: 'N/A',
    lastTestDate: 'N/A',
  });

  const calculateStats = (testsData: Test[]) => {
    if (!testsData || testsData.length === 0) {
        setStats({ totalTests: 0, avgRisk: 'N/A', lastTestDate: 'N/A' });
        return;
    };

    const totalTests = testsData.length;
    
    const lastTestDate = new Date(testsData[0].created_at);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - lastTestDate.getTime()) / (1000 * 3600 * 24));
    const lastTestDateStr = diffDays === 0 ? 'Today' : `${diffDays}d ago`;

    const testsWithRisk = testsData.filter(t => (t.result as any)?.riskScore);
    const avgRisk = testsWithRisk.length > 0 
        ? (testsWithRisk.reduce((acc, t) => acc + (t.result as any).riskScore, 0) / testsWithRisk.length).toFixed(1)
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
        setTimeout(() => reject(new Error('Query timeout')), 2000)
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

  const fetchAppointments = async () => {
    if (!user) {
        return;
    }

    try {
      const { data, error } = await mongodb
        .from('appointments')
        .select('*')
        .eq('patient_id', user.id)
        .order('appointment_date', { ascending: true });

      if (error) {
        console.error('Error fetching appointments:', error);
        // Table might not exist yet - that's okay
      } else {
        setAppointments(data ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
      // Silently fail if appointments table doesn't exist
    }
  };

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
          return;
        }
      } catch (e) {
        console.log('Cache parse error:', e);
      }
    }
    
    // Call fetchTests immediately
    fetchTests();
    
    // Call fetchAppointments (non-blocking)
    fetchAppointments().catch(err => {
      console.log('Appointments feature not available yet:', err);
    });

    // Setup realtime subscriptions
    const channel = mongodb.channel('realtime-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tests', filter: `patient_id=eq.${user.id}`},
        (payload: unknown) => {
          console.log('Realtime change received!', payload);
          fetchTests();
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `patient_id=eq.${user.id}`},
        (payload: unknown) => {
          console.log('Appointments realtime change!', payload);
          fetchAppointments();
        })
      .subscribe();

    // Poll localStorage for new tests every 5 seconds for real-time updates (silent)
    const pollInterval = setInterval(() => {
      console.log('🔄 Polling for new tests...');
      fetchTests(true); // Silent refresh
    }, 5000);

    // Listen for storage events from other tabs/windows
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'local_tests' || e.key === 'local_test_results') {
        console.log('📢 Storage change detected, refreshing tests...');
        fetchTests(true); // Silent refresh
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
        mongodb.removeChannel(channel);
        clearInterval(pollInterval);
        window.removeEventListener('storage', handleStorageChange);
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
          to="/auth"
          className="rounded-lg bg-primary px-6 py-2 text-primary-foreground hover:opacity-90"
        >
          Go to Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-600">Total Tests</p>
            <BarChart className="h-5 w-5 text-blue-600" />
          </div>
          <p className="text-2xl font-bold mt-2 text-gray-900">{stats.totalTests}</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-600">Average Risk</p>
            <Activity className="h-5 w-5 text-blue-600" />
          </div>
          <p className="text-2xl font-bold mt-2 text-orange-500">{stats.avgRisk} / 10</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-600">Last Test</p>
            <FileText className="h-5 w-5 text-blue-600" />
          </div>
          <p className="text-2xl font-bold mt-2 text-gray-900">{stats.lastTestDate}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3 h-80">
            <h3 className="font-semibold mb-4 flex items-center text-gray-900"><TrendingUp size={18} className="mr-2 text-blue-600" /> Risk Score Over Time</h3>
            {tests.length > 0 ? <Chart option={getRiskScoreChartOption(tests)} /> : <p className="text-center text-gray-600 pt-16">No test results yet.</p>}
        </Card>
        <Card className="lg:col-span-2 h-80">
            <h3 className="font-semibold mb-4 flex items-center text-gray-900"><PieChart size={18} className="mr-2 text-blue-600" /> Test Type Distribution</h3>
            {tests.length > 0 ? <Chart option={getDistributionChartOption(tests)} /> : <p className="text-center text-gray-600 pt-16">No tests performed yet.</p>}
        </Card>
      </div>

      <Card>
        <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold flex items-center text-gray-900"><List size={18} className="mr-2 text-blue-600" /> Recent Tests</h3>
            <Link to="/history" className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline">View All</Link>
        </div>
        <div className="space-y-2">
          {tests.slice(0, 3).map((item) => (
            <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <div className="flex items-center space-x-4">
                <span className="font-medium capitalize text-gray-900">{item.test_type} Test</span>
                <span className="text-sm text-gray-600">{new Date(item.created_at).toLocaleDateString()}</span>
              </div>
              <span className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full capitalize">
                { (item.result as any)?.riskScore ? `Risk: ${(item.result as any).riskScore}/10` : 'Processing...' }
              </span>
            </div>
          ))}
          {tests.length === 0 && <p className="text-center text-gray-600 py-4">You haven't performed any tests yet.</p>}
        </div>
      </Card>

      {/* Appointments Section - Only show if table exists */}
      {appointments.length > 0 || (tests.length > 0 && appointments.length === 0) ? (
      <Card>
        <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold flex items-center text-gray-900"><Calendar size={18} className="mr-2 text-blue-600" /> Upcoming Appointments</h3>
            <Link to="/consult" className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline">Book New</Link>
        </div>
        <div className="space-y-3">
          {appointments
            .filter(apt => new Date(apt.appointment_date) >= new Date())
            .slice(0, 3)
            .map((appointment) => (
            <div key={appointment.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200 hover:border-blue-300 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="font-semibold text-gray-900">{appointment.doctor_name}</h4>
                  <p className="text-sm text-gray-600">{appointment.doctor_hospital}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full capitalize ${
                  appointment.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                  appointment.status === 'completed' ? 'bg-green-100 text-green-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {appointment.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {new Date(appointment.appointment_date).toLocaleDateString()}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {appointment.appointment_time}
                </span>
              </div>
              {appointment.prescription_storage_path && (
                <a
                  href={getPrescriptionUrl(appointment.prescription_storage_path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 mt-2 text-sm text-blue-600 hover:text-blue-700 hover:underline"
                >
                  <FileDown className="h-4 w-4" />
                  View Prescription
                </a>
              )}
            </div>
          ))}
          {appointments.filter(apt => new Date(apt.appointment_date) >= new Date()).length === 0 && (
            <p className="text-center text-gray-600 py-4">No upcoming appointments.</p>
          )}
        </div>
      </Card>
      ) : null}
    </div>
  );
};

export default Dashboard;
