import * as React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_HOME_ROUTE, UserRole } from '@careerpilot/shared';
import { AppLayout } from '@/layouts/AppLayout';
import { LoadingState } from '@/components/ui';
import { useAuthStore } from '@/store/auth.store';
import { connectSocket, disconnectSocket } from '@/services/socket';

/* ---- Eagerly loaded: needed on first paint ---- */
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { StudentDashboard } from '@/pages/student/StudentDashboard';

/**
 * Route-level code splitting. The assessment, coding and interview screens pull
 * in heavy dependencies (editor, charts), so they load on demand rather than
 * being paid for on every visit.
 */
const ProfilePage = React.lazy(() => import('@/pages/student/ProfilePage'));
const ResumePage = React.lazy(() => import('@/pages/student/ResumePage'));
const JobMatchingPage = React.lazy(() => import('@/pages/student/JobMatchingPage'));
const AssessmentsPage = React.lazy(() => import('@/pages/student/AssessmentsPage'));
const AssessmentRunnerPage = React.lazy(() => import('@/pages/student/AssessmentRunnerPage'));
const AssessmentResultPage = React.lazy(() => import('@/pages/student/AssessmentResultPage'));
const CodingPage = React.lazy(() => import('@/pages/student/CodingPage'));
const CodingProblemPage = React.lazy(() => import('@/pages/student/CodingProblemPage'));
const InterviewPage = React.lazy(() => import('@/pages/student/InterviewPage'));
const InterviewRunnerPage = React.lazy(() => import('@/pages/student/InterviewRunnerPage'));
const InterviewReportPage = React.lazy(() => import('@/pages/student/InterviewReportPage'));
const ReadinessPage = React.lazy(() => import('@/pages/student/ReadinessPage'));
const CareerPlanPage = React.lazy(() => import('@/pages/student/CareerPlanPage'));
const AlumniDirectoryPage = React.lazy(() => import('@/pages/student/AlumniDirectoryPage'));
const MentorshipPage = React.lazy(() => import('@/pages/student/MentorshipPage'));
const InterviewRoomPage = React.lazy(() => import('@/pages/student/InterviewRoomPage'));
const ReportsPage = React.lazy(() => import('@/pages/student/ReportsPage'));
const SettingsPage = React.lazy(() => import('@/pages/student/SettingsPage'));

const AlumniDashboard = React.lazy(() => import('@/pages/alumni/AlumniDashboard'));
const AlumniProfilePage = React.lazy(() => import('@/pages/alumni/AlumniProfilePage'));
const AlumniRequestsPage = React.lazy(() => import('@/pages/alumni/AlumniRequestsPage'));
const AlumniSessionsPage = React.lazy(() => import('@/pages/alumni/AlumniSessionsPage'));
const AlumniFeedbackPage = React.lazy(() => import('@/pages/alumni/AlumniFeedbackPage'));

const PlacementDashboard = React.lazy(() => import('@/pages/placement/PlacementDashboard'));
const PlacementStudentsPage = React.lazy(() => import('@/pages/placement/PlacementStudentsPage'));
const PlacementAnalyticsPage = React.lazy(() => import('@/pages/placement/PlacementAnalyticsPage'));
const PlacementReportsPage = React.lazy(() => import('@/pages/placement/PlacementReportsPage'));

const AdminDashboard = React.lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminUsersPage = React.lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminAlumniPage = React.lazy(() => import('@/pages/admin/AdminAlumniPage'));
const AdminCompaniesPage = React.lazy(() => import('@/pages/admin/AdminCompaniesPage'));
const AdminJobsPage = React.lazy(() => import('@/pages/admin/AdminJobsPage'));
const AdminAiPage = React.lazy(() => import('@/pages/admin/AdminAiPage'));
const AdminAuditPage = React.lazy(() => import('@/pages/admin/AdminAuditPage'));

const NotFoundPage = React.lazy(() => import('@/pages/NotFoundPage'));

/** Redirects to sign-in, preserving the intended destination. */
function RequireAuth({ roles, children }: { roles?: UserRole[]; children: React.ReactNode }) {
  const { user, status } = useAuthStore();
  const location = useLocation();

  if (status === 'idle' || status === 'loading') {
    return <LoadingState label="Restoring your session…" className="min-h-screen" />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    // Send the user to their own home rather than showing a bare 403.
    return <Navigate to={ROLE_HOME_ROUTE[user.role]} replace />;
  }

  return <>{children}</>;
}

function RedirectHome() {
  const { user, status } = useAuthStore();
  if (status === 'idle' || status === 'loading') {
    return <LoadingState label="Loading…" className="min-h-screen" />;
  }
  return <Navigate to={user ? ROLE_HOME_ROUTE[user.role] : '/login'} replace />;
}

function Suspended({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<LoadingState label="Loading page…" />}>{children}</React.Suspense>;
}

export default function App() {
  const { status, bootstrap } = useAuthStore();

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // The realtime connection follows the session: opened on sign-in, closed on
  // sign-out, so an anonymous visitor never holds a socket.
  React.useEffect(() => {
    if (status === 'authenticated') {
      connectSocket();
    } else if (status === 'unauthenticated') {
      disconnectSocket();
    }
    return () => {
      if (status === 'unauthenticated') disconnectSocket();
    };
  }, [status]);

  const student = [UserRole.STUDENT];
  const alumni = [UserRole.ALUMNI];
  const officer = [UserRole.PLACEMENT_OFFICER, UserRole.ADMIN];
  const admin = [UserRole.ADMIN];

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/**
        * The assessment runner sits OUTSIDE AppLayout: full-screen mode must not
        * render the sidebar or header at all (§13).
        */}
      <Route
        path="/assessments/attempt/:attemptId"
        element={
          <RequireAuth roles={student}>
            <Suspended>
              <AssessmentRunnerPage />
            </Suspended>
          </RequireAuth>
        }
      />

      {/* Authenticated shell */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<RedirectHome />} />

        {/* Student */}
        <Route path="/dashboard" element={<RequireAuth roles={student}><StudentDashboard /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth roles={student}><Suspended><ProfilePage /></Suspended></RequireAuth>} />
        <Route path="/resume" element={<RequireAuth roles={student}><Suspended><ResumePage /></Suspended></RequireAuth>} />
        <Route path="/job-matching" element={<RequireAuth roles={student}><Suspended><JobMatchingPage /></Suspended></RequireAuth>} />
        <Route path="/assessments" element={<RequireAuth roles={student}><Suspended><AssessmentsPage /></Suspended></RequireAuth>} />
        <Route path="/assessments/result/:attemptId" element={<RequireAuth roles={student}><Suspended><AssessmentResultPage /></Suspended></RequireAuth>} />
        <Route path="/coding" element={<RequireAuth roles={student}><Suspended><CodingPage /></Suspended></RequireAuth>} />
        <Route path="/coding/:problemId" element={<RequireAuth roles={student}><Suspended><CodingProblemPage /></Suspended></RequireAuth>} />
        <Route path="/interview" element={<RequireAuth roles={student}><Suspended><InterviewPage /></Suspended></RequireAuth>} />
        <Route path="/interview/session/:sessionId" element={<RequireAuth roles={student}><Suspended><InterviewRunnerPage /></Suspended></RequireAuth>} />
        <Route path="/interview/report/:sessionId" element={<RequireAuth roles={student}><Suspended><InterviewReportPage /></Suspended></RequireAuth>} />
        <Route path="/readiness" element={<RequireAuth roles={student}><Suspended><ReadinessPage /></Suspended></RequireAuth>} />
        <Route path="/career" element={<RequireAuth roles={student}><Suspended><CareerPlanPage /></Suspended></RequireAuth>} />
        <Route path="/career/:tab" element={<RequireAuth roles={student}><Suspended><CareerPlanPage /></Suspended></RequireAuth>} />
        <Route path="/alumni" element={<RequireAuth roles={student}><Suspended><AlumniDirectoryPage /></Suspended></RequireAuth>} />
        <Route path="/mentorship" element={<RequireAuth roles={student}><Suspended><MentorshipPage /></Suspended></RequireAuth>} />
        <Route path="/reports" element={<RequireAuth roles={student}><Suspended><ReportsPage /></Suspended></RequireAuth>} />

        {/* Interview room: both the student and the alumni mentor join here (§19) */}
        <Route path="/mentorship/session/:sessionId" element={<Suspended><InterviewRoomPage /></Suspended>} />

        <Route path="/settings" element={<Suspended><SettingsPage /></Suspended>} />

        {/* Alumni */}
        <Route path="/alumni/dashboard" element={<RequireAuth roles={alumni}><Suspended><AlumniDashboard /></Suspended></RequireAuth>} />
        <Route path="/alumni/profile" element={<RequireAuth roles={alumni}><Suspended><AlumniProfilePage /></Suspended></RequireAuth>} />
        <Route path="/alumni/requests" element={<RequireAuth roles={alumni}><Suspended><AlumniRequestsPage /></Suspended></RequireAuth>} />
        <Route path="/alumni/sessions" element={<RequireAuth roles={alumni}><Suspended><AlumniSessionsPage /></Suspended></RequireAuth>} />
        <Route path="/alumni/feedback" element={<RequireAuth roles={alumni}><Suspended><AlumniFeedbackPage /></Suspended></RequireAuth>} />

        {/* Placement officer */}
        <Route path="/placement/dashboard" element={<RequireAuth roles={officer}><Suspended><PlacementDashboard /></Suspended></RequireAuth>} />
        <Route path="/placement/students" element={<RequireAuth roles={officer}><Suspended><PlacementStudentsPage /></Suspended></RequireAuth>} />
        <Route path="/placement/analytics" element={<RequireAuth roles={officer}><Suspended><PlacementAnalyticsPage /></Suspended></RequireAuth>} />
        <Route path="/placement/reports" element={<RequireAuth roles={officer}><Suspended><PlacementReportsPage /></Suspended></RequireAuth>} />

        {/* Admin */}
        <Route path="/admin/dashboard" element={<RequireAuth roles={admin}><Suspended><AdminDashboard /></Suspended></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth roles={admin}><Suspended><AdminUsersPage /></Suspended></RequireAuth>} />
        <Route path="/admin/alumni" element={<RequireAuth roles={admin}><Suspended><AdminAlumniPage /></Suspended></RequireAuth>} />
        <Route path="/admin/companies" element={<RequireAuth roles={admin}><Suspended><AdminCompaniesPage /></Suspended></RequireAuth>} />
        <Route path="/admin/jobs" element={<RequireAuth roles={admin}><Suspended><AdminJobsPage /></Suspended></RequireAuth>} />
        <Route path="/admin/ai" element={<RequireAuth roles={admin}><Suspended><AdminAiPage /></Suspended></RequireAuth>} />
        <Route path="/admin/audit" element={<RequireAuth roles={admin}><Suspended><AdminAuditPage /></Suspended></RequireAuth>} />

        <Route path="*" element={<Suspended><NotFoundPage /></Suspended>} />
      </Route>
    </Routes>
  );
}
