import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import Dashboard from './pages/Dashboard';
import NewTest from './pages/NewTest';
import History from './pages/History';
import Chatbot from './pages/Chatbot';
import Orders from './pages/Orders';
import Auth from './pages/Auth';
import AdminLogin from './pages/AdminLogin';
import Landing from './pages/Landing';
import Profile from './pages/Profile';
import Therapy from './pages/Therapy';
import ComprehensiveScreening from './pages/ComprehensiveScreening';
import NutritionPlanner from './pages/NutritionPlanner';
import Consult from './pages/Consult';
import DoctorBooking from './pages/DoctorBooking';
import DoctorDashboard from './pages/DoctorDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ReportDetails from './pages/ReportDetails';
import AppointmentCommunication from './pages/AppointmentCommunication';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoaderCircle } from 'lucide-react';
import { getDashboardRouteForRole } from './services/healthcareApi';
import type { UserRole } from './types/healthcare';

const PrivateRoute = ({ children, allowedRoles }: { children: ReactElement; allowedRoles?: UserRole[] }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <LoaderCircle className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (user && allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={getDashboardRouteForRole(user.role)} replace />;
  }

  return user ? children : <Navigate to="/login" />;
};

const DashboardRedirect = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <LoaderCircle className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getDashboardRouteForRole(user.role)} replace />;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/admin-login" element={<AdminLogin />} />
          <Route path="/dashboard" element={<DashboardRedirect />} />
          <Route
            path="/patient-dashboard"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><Dashboard /></Layout></PrivateRoute>}
          />
          <Route
            path="/doctor-dashboard"
            element={<PrivateRoute allowedRoles={['doctor']}><Layout><DoctorDashboard /></Layout></PrivateRoute>}
          />
          <Route
            path="/admin-dashboard"
            element={<PrivateRoute allowedRoles={['admin']}><Layout><AdminDashboard /></Layout></PrivateRoute>}
          />
          <Route
            path="/new-test"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><NewTest /></Layout></PrivateRoute>}
          />
          <Route
            path="/history"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><History /></Layout></PrivateRoute>}
          />
          <Route
            path="/chatbot"
            element={<PrivateRoute><Layout><Chatbot /></Layout></PrivateRoute>}
          />
          <Route
            path="/orders"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><Orders /></Layout></PrivateRoute>}
          />
          <Route
            path="/profile"
            element={<PrivateRoute><Layout><Profile /></Layout></PrivateRoute>}
          />
          <Route
            path="/therapy"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><Therapy /></Layout></PrivateRoute>}
          />
          <Route
            path="/comprehensive-screening"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><ComprehensiveScreening /></Layout></PrivateRoute>}
          />
          <Route
            path="/nutrition-planner"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><NutritionPlanner /></Layout></PrivateRoute>}
          />
          <Route
            path="/consult"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><Consult /></Layout></PrivateRoute>}
          />
          <Route
            path="/consult/:doctorId/book"
            element={<PrivateRoute allowedRoles={['patient']}><Layout><DoctorBooking /></Layout></PrivateRoute>}
          />
          <Route
            path="/reports/:reportId"
            element={<PrivateRoute><Layout><ReportDetails /></Layout></PrivateRoute>}
          />
          <Route
            path="/appointments/:appointmentId/communication"
            element={<PrivateRoute><Layout><AppointmentCommunication /></Layout></PrivateRoute>}
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
