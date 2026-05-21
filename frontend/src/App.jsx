import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GamificationProvider } from './contexts/GamificationContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Analytics from './components/Analytics';

const Landing    = lazy(() => import('./pages/Landing'));
const Login      = lazy(() => import('./pages/Login'));
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
const Integritet = lazy(() => import('./pages/Integritet'));
const DuelPlay   = lazy(() => import('./pages/DuelPlay'));
const DuelResult = lazy(() => import('./pages/DuelResult'));
const LiveDuel   = lazy(() => import('./pages/LiveDuel'));

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container"><p>Laddar…</p></div>;
  if (!user) return <Navigate to="/login" replace />;
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
        <Route path="/register" element={user ? <Navigate to="/lists" replace /> : <Register />} />
        <Route path="/integritet" element={user ? <Layout><Integritet /></Layout> : <Integritet />} />

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

        <Route path="*" element={<Navigate to={user ? '/lists' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <GamificationProvider>
          <Analytics />
          <AppRoutes />
        </GamificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
