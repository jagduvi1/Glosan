import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GamificationProvider } from './contexts/GamificationContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import Analytics from './components/Analytics';
import { hasFeature } from './utils/features';

const Landing    = lazy(() => import('./pages/Landing'));
const Login      = lazy(() => import('./pages/Login'));
const LoginCallback = lazy(() => import('./pages/LoginCallback'));
const Register   = lazy(() => import('./pages/Register'));
const Lists      = lazy(() => import('./pages/Lists'));
const ListDetail = lazy(() => import('./pages/ListDetail'));
const Quiz       = lazy(() => import('./pages/Quiz'));
const Flashcards = lazy(() => import('./pages/Flashcards'));
const Results    = lazy(() => import('./pages/Results'));
const Profile    = lazy(() => import('./pages/Profile'));
const Dictionary = lazy(() => import('./pages/Dictionary'));
const CategoryQuiz = lazy(() => import('./pages/CategoryQuiz'));
const Friends   = lazy(() => import('./pages/Friends'));
const Admin     = lazy(() => import('./pages/Admin'));
const Galge     = lazy(() => import('./pages/Galge'));
const Ordfall   = lazy(() => import('./pages/Ordfall'));
const SnakeGame = lazy(() => import('./pages/SnakeGame'));
const Integritet = lazy(() => import('./pages/Integritet'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const MagicLink = lazy(() => import('./pages/MagicLink'));
const JoinList = lazy(() => import('./pages/JoinList'));
const JoinStudyUnit = lazy(() => import('./pages/JoinStudyUnit'));
const ConnectAiAuthorize = lazy(() => import('./pages/ConnectAiAuthorize'));
const Plugga = lazy(() => import('./pages/Plugga'));
const PluggaSubject = lazy(() => import('./pages/PluggaSubject'));
const PluggaUnit = lazy(() => import('./pages/PluggaUnit'));
const PluggaPractice = lazy(() => import('./pages/PluggaPractice'));
const PluggaFolder = lazy(() => import('./pages/PluggaFolder'));
const PluggaActivity = lazy(() => import('./pages/PluggaActivity'));
const PluggaTest = lazy(() => import('./pages/PluggaTest'));
const PluggaTestPaper = lazy(() => import('./pages/PluggaTestPaper'));
const PluggaTestResult = lazy(() => import('./pages/PluggaTestResult'));
const DuelPlay   = lazy(() => import('./pages/DuelPlay'));
const DuelResult = lazy(() => import('./pages/DuelResult'));
const LiveDuel   = lazy(() => import('./pages/LiveDuel'));
const NotFound   = lazy(() => import('./pages/NotFound'));

// Ett nytt pass för varje navigering ("Öva igen", tillbaka-knappen): sidan
// monteras om, så inget ligger kvar från förra passet — och det gamla passet
// avslutas (XP, streak) när det lämnas.
function PracticeRoute() {
  const location = useLocation();
  return <PluggaPractice key={location.key} />;
}

// Sidor bakom en funktionsflagga: för den som saknar flaggan finns sidan
// inte (NotFound) — samma "dold"-beteende som backend (404).
// Utloggad (sessionen gick ut): till /login och tillbaka hit efteråt — samma
// som ProtectedRoute, så Plugga- och admin-sidorna inte landar på listorna.
function LoginFirst() {
  const location = useLocation();
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

function FeatureRoute({ feature, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container"><p>Laddar…</p></div>;
  if (!user) return <LoginFirst />;
  if (!hasFeature(user, feature)) return <Layout><NotFound /></Layout>;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container"><p>Laddar…</p></div>;
  if (!user) return <LoginFirst />;
  if (!user.roles?.includes('admin')) return <Navigate to="/lists" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="container"><p>Laddar…</p></div>;
  }

  return (
    <Suspense fallback={<div className="container"><p>Laddar…</p></div>}>
      <Routes>
        <Route path="/login"    element={user ? <Navigate to="/lists" replace /> : <Login />} />
        {/* Landning efter Google-rundresan — navigerar själv utifrån user/error,
            så den gateas inte på user som /login. */}
        <Route path="/login/callback" element={<LoginCallback />} />
        <Route path="/register" element={user ? <Navigate to="/lists" replace /> : <Register />} />
        <Route path="/integritet" element={user ? <Layout><Integritet /></Layout> : <Integritet />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/lists" replace /> : <ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/magic-link" element={user ? <Navigate to="/lists" replace /> : <MagicLink />} />
        <Route path="/j/:code" element={<JoinList />} />
        {/* Delat Plugga-område (QR-kod). Publik och INTE bakom flaggan — den som
            går med får Plugga påslaget. */}
        <Route path="/p/:code" element={<JoinStudyUnit />} />
        {/* OAuth-samtycket för MCP-connectorn — hanterar utloggat läge själv
            så att OAuth-parametrarna ligger kvar i URL:en. */}
        <Route path="/connect-ai/authorize" element={<ConnectAiAuthorize />} />

        <Route path="/" element={user ? <Navigate to="/lists" replace /> : <Landing />} />

        <Route
          path="/lists"
          element={
            <ProtectedRoute>
              <Layout><Lists /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id"
          element={
            <ProtectedRoute>
              <Layout><ListDetail /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id/quiz"
          element={
            <ProtectedRoute>
              <Layout><Quiz /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id/flashcards"
          element={
            <ProtectedRoute>
              <Layout><Flashcards /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id/results"
          element={
            <ProtectedRoute>
              <Layout><Results /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/plugga"
          element={
            <FeatureRoute feature="study">
              <Layout><Plugga /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/plugga/amne/:subject"
          element={
            <FeatureRoute feature="study">
              <Layout><PluggaSubject /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/plugga/omrade/:id"
          element={
            <FeatureRoute feature="study">
              <Layout><PluggaUnit /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/plugga/prov/:id"
          element={
            <FeatureRoute feature="study">
              <Layout><PluggaTest /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/plugga/prov/:id/papper"
          element={
            <FeatureRoute feature="study">
              <Layout><PluggaTestPaper /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/plugga/prov/:id/resultat/:attemptId"
          element={
            <FeatureRoute feature="study">
              <Layout><PluggaTestResult /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/plugga/min-plugg"
          element={
            <FeatureRoute feature="study">
              <Layout><PluggaActivity /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/plugga/mapp/:id"
          element={
            <FeatureRoute feature="study">
              <Layout><PluggaFolder /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/plugga/ova"
          element={
            <FeatureRoute feature="study">
              <Layout><PracticeRoute /></Layout>
            </FeatureRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Layout><Profile /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/ordbok"
          element={
            <ProtectedRoute>
              <Layout><Dictionary /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/categories/:catId/quiz"
          element={
            <ProtectedRoute>
              <Layout><CategoryQuiz /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/kompisar"
          element={
            <ProtectedRoute>
              <Layout><Friends /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <Layout><Admin /></Layout>
            </AdminRoute>
          }
        />
        <Route
          path="/lists/:id/galge"
          element={
            <ProtectedRoute>
              <Layout><Galge /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id/ordfall"
          element={
            <ProtectedRoute>
              <Layout><Ordfall /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id/orm"
          element={
            <ProtectedRoute>
              <Layout><SnakeGame /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/duels/:id/play"
          element={
            <ProtectedRoute>
              <Layout><DuelPlay /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/duels/:id/result"
          element={
            <ProtectedRoute>
              <Layout><DuelResult /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/duels/:id/live"
          element={
            <ProtectedRoute>
              <Layout><LiveDuel /></Layout>
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            user
              ? <Layout><NotFound /></Layout>
              : <Navigate to="/login" replace />
          }
        />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <GamificationProvider>
            <Analytics />
            <AppRoutes />
          </GamificationProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
