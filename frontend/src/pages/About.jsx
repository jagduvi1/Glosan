import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import PublicShell from '../components/PublicShell';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../utils/useDocumentTitle';

// /om — Om Glosan: vem som gjorde appen och vem som driver den. Publik.
// Majken är ett barn: på sidan bara förnamnet, aldrig skola eller ort.
// Länken till källkoden är Johans val (2026-10-06), fast historiken där visar
// hela hennes namn. Flyttas repot till ett konto i hennes namn: byt REPO_URL
// (GitHub skickar vidare från den gamla adressen).
const CONTACT_EMAIL = 'info@glosan.app';
const REPO_URL = 'https://github.com/jagduvi1/Glosan';

function AboutText({ loggedIn }) {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <GloAvatar size={72} float mood="wink" tilt={-4} />
        <div>
          <div className="t-hand muted" style={{ fontSize: 16 }}>Glosan</div>
          <h1 style={{ margin: '2px 0 0' }}>Om Glosan</h1>
        </div>
      </div>
      <p style={{ fontSize: 18, marginTop: 0 }}>
        Glosan är en gratis app för att plugga glosor — och numera alla skolämnen. Inga annonser, ingen
        prenumeration och inga tredjepartscookies.
      </p>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Så började det</h2>
        <p style={{ margin: 0 }}>
          Glosan skapades av <strong>Majken</strong> när hon gjorde prao i årskurs 6. Det som började som ett
          praoprojekt har sedan dess vuxit till sex sätt att öva på glosor, dueller mot kompisar, streaks — och
          Plugga, där din egen AI gör om sidorna i boken till genomgångar, kort och övningar i alla ämnen.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Vem driver Glosan?</h2>
        <p style={{ margin: 0 }}>
          Det är Majken som driver Glosan i dag, med hjälp av sin pappa.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Öppen källkod</h2>
        <p style={{ margin: 0 }}>
          All kod till Glosan är öppen och finns på{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>, under licensen AGPL-3.0.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Hör av dig</h2>
        <p style={{ margin: 0 }}>
          Har du hittat ett fel eller har en idé? Skriv till <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          Hur Glosan hanterar dina uppgifter står i <Link to="/integritet">integritetspolicyn</Link>.
        </p>
      </section>

      {!loggedIn && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center', margin: '8px 0 24px' }}>
          <Link to="/register"><button className="btn btn-primary" type="button">Skapa konto — gratis</button></Link>
        </div>
      )}
    </div>
  );
}

export default function About() {
  useDocumentTitle('Om Glosan');
  const { user } = useAuth();
  const head = (
    <Helmet>
      <title>Om Glosan — Glosan</title>
      <meta name="description" content="Om Glosan: en gratis app för glosor och alla skolämnen, utan annonser. Så började den och vem som driver den." />
      <link rel="canonical" href="https://glosan.app/om" />
    </Helmet>
  );
  if (user) return <>{head}<AboutText loggedIn /></>;
  return (
    <PublicShell>
      {head}
      <AboutText loggedIn={false} />
    </PublicShell>
  );
}
