import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, ShieldCheck, Users, XCircle } from 'lucide-react';
import Card from '../components/Card';
import Chart from '../components/Chart';
import { getAdminDoctors, getAdminUsers, updateDoctorApproval } from '../services/healthcareApi';
import type { AppUser } from '../types/healthcare';

const roleChartOption = (users: AppUser[]) => {
  const counts = users.reduce((acc, user) => {
    acc[user.role] = (acc[user.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['50%', '78%'],
      data: Object.entries(counts).map(([name, value]) => ({ name, value })),
      color: ['#5D7052', '#C18C5D', '#A85448'],
    }],
  };
};

const approvalChartOption = (doctors: AppUser[]) => {
  const statuses = ['pending', 'approved', 'rejected'];
  const counts = statuses.map((status) => doctors.filter((doctor) => doctor.approval_status === status).length);
  return {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: statuses, axisLabel: { color: '#6B7280' } },
    yAxis: { type: 'value', axisLabel: { color: '#6B7280' } },
    series: [{
      type: 'bar',
      data: counts,
      itemStyle: {
        color: (params: any) => ['#C18C5D', '#5D7052', '#A85448'][params.dataIndex],
        borderRadius: [10, 10, 0, 0],
      },
    }],
    grid: { left: '8%', right: '4%', top: '10%', bottom: '15%', containLabel: true },
  };
};

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState<AppUser[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [doctorData, userData] = await Promise.all([
        getAdminDoctors(),
        getAdminUsers(),
      ]);
      setDoctors(doctorData);
      setUsers(userData);
    } catch (error) {
      console.error('Failed to load admin dashboard:', error);
      setDoctors([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const pendingDoctors = useMemo(
    () => doctors.filter((doctor) => doctor.approval_status === 'pending'),
    [doctors],
  );

  const handleApproval = async (doctorId: string, approvalStatus: 'approved' | 'rejected') => {
    setProcessingId(doctorId);
    try {
      await updateDoctorApproval(doctorId, approvalStatus);
      await loadData();
    } catch (error) {
      console.error('Failed to update doctor approval:', error);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="rounded-[2rem] bg-primary/10 p-4">
          <ShieldCheck className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-4xl font-serif font-bold text-foreground">Admin Dashboard</h2>
          <p className="text-muted-foreground mt-1">Approve doctors, monitor platform users, and keep the clinical workflow trusted.</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="rounded-organic-1 bg-background/70">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">Total Users</p>
          <p className="mt-3 text-4xl font-serif font-bold text-foreground">{users.length}</p>
        </Card>
        <Card className="rounded-organic-2 bg-background/70">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">Doctors</p>
          <p className="mt-3 text-4xl font-serif font-bold text-secondary">{doctors.length}</p>
        </Card>
        <Card className="rounded-organic-3 bg-background/70">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">Pending Approvals</p>
          <p className="mt-3 text-4xl font-serif font-bold text-primary">{pendingDoctors.length}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-organic-1 bg-background/70">
          <div className="border-b border-border/30 pb-4">
            <h3 className="text-2xl font-serif font-bold text-foreground">Role Distribution</h3>
            <p className="text-sm text-muted-foreground mt-1">Track how the platform is split between patient, doctor, and admin accounts.</p>
          </div>
          <div className="mt-5 h-80">
            <Chart option={roleChartOption(users)} />
          </div>
        </Card>

        <Card className="rounded-organic-2 bg-background/70">
          <div className="border-b border-border/30 pb-4">
            <h3 className="text-2xl font-serif font-bold text-foreground">Doctor Approval Status</h3>
            <p className="text-sm text-muted-foreground mt-1">Review how many doctors are pending, approved, or rejected.</p>
          </div>
          <div className="mt-5 h-80">
            <Chart option={approvalChartOption(doctors)} />
          </div>
        </Card>
      </div>

      <Card className="rounded-organic-4 bg-background/70">
        <div className="flex items-center gap-3 border-b border-border/30 pb-4">
          <div className="rounded-2xl bg-primary/10 p-2.5">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-2xl font-serif font-bold text-foreground">Doctor Approval Queue</h3>
            <p className="text-sm text-muted-foreground">Approve doctors before they appear in patient booking and report review flows.</p>
          </div>
        </div>
        <div className="mt-5 space-y-4">
          {pendingDoctors.length > 0 ? pendingDoctors.map((doctor, index) => (
            <div key={doctor.id} className={`rounded-organic-${(index % 4) + 1} border border-border/40 bg-background/50 p-5`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xl font-serif font-bold text-foreground">{doctor.full_name || doctor.email}</p>
                  <p className="text-sm text-muted-foreground mt-1">{doctor.hospital || 'Hospital not provided'}</p>
                  <p className="text-sm text-muted-foreground mt-1">{doctor.qualification || 'Qualification not provided'}</p>
                  <p className="text-sm text-muted-foreground mt-1">{doctor.specialties?.join(', ') || 'Specialties not provided'}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    ID: {doctor.doctor_identifier || 'N/A'} • Age: {doctor.age || 'N/A'} • Experience: {doctor.years_experience ?? 'N/A'} yrs
                  </p>
                  <p className="text-xs uppercase tracking-wide text-secondary mt-3 font-semibold">Pending approval</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => handleApproval(doctor.id, 'approved')}
                    disabled={processingId === doctor.id}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </button>
                  <button
                    onClick={() => handleApproval(doctor.id, 'rejected')}
                    disabled={processingId === doctor.id}
                    className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 disabled:opacity-60 transition-colors"
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </button>
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-3xl border border-dashed border-border/60 bg-background/40 p-8 text-center">
              <p className="text-2xl font-serif font-bold text-foreground">No doctors waiting</p>
              <p className="text-sm text-muted-foreground mt-2">New doctor registrations will appear here for approval.</p>
            </div>
          )}
        </div>
      </Card>

      <Card className="rounded-organic-2 bg-background/70">
        <div className="flex items-center gap-3 border-b border-border/30 pb-4">
          <div className="rounded-2xl bg-secondary/10 p-2.5">
            <Users className="h-5 w-5 text-secondary" />
          </div>
          <div>
            <h3 className="text-2xl font-serif font-bold text-foreground">All Users</h3>
            <p className="text-sm text-muted-foreground">Single sign-in system with role visibility for patient, doctor, and admin accounts.</p>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {users.map((user, index) => (
            <div key={user.id} className={`rounded-organic-${(index % 4) + 1} border border-border/40 bg-background/50 p-4`}>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-serif font-bold text-foreground">{user.full_name || user.email}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                  {user.role === 'doctor' && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {user.hospital || 'Hospital N/A'} • {user.doctor_identifier || 'No doctor ID'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary capitalize">{user.role}</span>
                  <span className="rounded-full bg-muted/70 px-3 py-1 font-semibold text-foreground capitalize">{user.approval_status || 'approved'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default AdminDashboard;
