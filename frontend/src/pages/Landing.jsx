import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import Sparkle from '../components/Sparkle';
import Flag from '../components/Flag';

const FAQ = [
  {
    q: 'Är Glosan gratis?',
    a: 'Ja, helt gratis. Inga annonser, ingen prenumeration och inga tredjepart-cookies. Skapa konto, plugga och kom tillbaka — det är hela affärsmodellen.'
  },
  {
    q: 'Vilka språk kan jag plugga?',
    a: 'Du sätter själv käll- och målspråk per lista. Vi har dedikerade flaggor och uttal för franska, tyska, spanska, engelska och svenska — men du kan skapa listor på vilket språkpar som helst.'
  },
  {
    q: 'Hur funkar AI-funktionerna?',
    a: 'Skriv ett tema (t.ex. "matvaror på franska") så genererar Glo en lista med översättningar. Du kan också få exempelmeningar för svåra ord eller låta Glo översätta en enstaka glosa du fastnar på.'
  },
  {
    q: 'Måste jag ladda ner en app?',
    a: 'Nej. Glosan körs i webbläsaren på dator, surfplatta och mobil — utan att ladda ner något. Lägg till glosan.app på hemskärmen om du vill ha en app-känsla.'
  },
  {
    q: 'Är min data säker?',
    a: 'Ja. Vi följer GDPR, lagrar lösenord hashade med bcrypt och du kan när som helst exportera eller radera ditt konto från profilsidan. Inga tredjepart-cookies, ingen reklam-tracking.'
  },
  {
    q: 'Kan jag öva med kompisar?',
    a: 'Ja — dela dina listor read-only eller med skrivrätt, utmana en kompis i async-duell, ta en live-duell över Socket.IO eller jämför era streaks och rekord på leaderboards.'
  }
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a }
  }))
};

const GAMES = [
  { icon: '🃏', title: 'Flashkort', text: 'Klicka för att vända. Ingen skrivning — bara nöt in.', bg: 'var(--plum-soft)' },
  { icon: '✎',  title: 'Skriv',     text: 'Stava översättningen själv. Hårdast och bäst.',           bg: 'var(--leaf-soft)' },
  { icon: '◉',  title: '4 val',     text: 'Välj rätt av fyra. Snabb och rolig.',                     bg: 'var(--mustard-soft)' },
  { icon: '🪢', title: 'Glos-galge', text: 'Klassisk hänga gubbe med Glo. Gissa bokstäverna.',       bg: 'var(--berry-soft)' },
  { icon: '⬇',  title: 'Ordfall',   text: 'Orden faller — skriv översättningen innan de landar.',   bg: 'var(--sky-soft)' },
  { icon: '🐍', title: 'Orm',       text: 'Styr ormen och ät rätt färg-box för översättningen.',    bg: 'var(--coral-soft)' }
];

export default function Landing() {
  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <Helmet>
        <title>Glosan — Lär dig glosor smart med AI och kompis-utmaningar</title>
        <meta name="description" content="Glosan är en gratis svensk glos-app med AI. Skapa egna ordlistor, öva med sex spellägen, utmana kompisar i live-dueller och samla streaks." />
        <link rel="canonical" href="https://glosan.app/" />
        <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
      </Helmet>
      <nav className="navbar" style={{ background: 'transparent', borderBottom: 'none' }}>
        <div className="nav-inner">
          <img src="/assets/logo-wordmark.svg" height={44} alt="Glosan" />
          <div className="row" style={{ gap: 12 }}>
            <Link to="/login"><button className="btn btn-sm btn-ghost">Logga in</button></Link>
            <Link to="/register"><button className="btn btn-sm btn-primary">Hoppa in — gratis</button></Link>
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div className="auth-grid" style={{ padding: 0, gap: 56, maxWidth: 'none' }}>
          <div>
            <span className="pill tilt-l" style={{ background: 'var(--mustard)', marginBottom: 22 }}>
              <Sparkle size={14} /> Gratis · ingen app att ladda ner
            </span>
            <h1 style={{ fontSize: 56, lineHeight: 1.05, margin: '0 0 18px' }}>
              Glosor som <span className="mark-highlight">fastnar</span>.<br />
              Plugg som inte&nbsp;suger.
            </h1>
            <p style={{ fontSize: 19, color: 'var(--ink-soft)', maxWidth: 480, margin: '0 0 24px' }}>
              Klistra in glosorna från din läxa — Glo tolkar formatet, bygger listan och nöter med dig. Sex spellägen och kompis-utmaningar. Inga annonser. Inget rotande i menyer.
            </p>
            <div className="row" style={{ gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <Link to="/register"><button className="btn btn-primary btn-lg">Börja öva nu →</button></Link>
              <a href="#hur-funkar-det" style={{ textDecoration: 'none', color: 'inherit' }}>
                <button className="btn btn-lg">Hur funkar det?</button>
              </a>
            </div>
          </div>

          <div style={{ position: 'relative', minHeight: 380 }}>
            <div
              className="card card-lg"
              style={{
                background: 'var(--mustard-soft)',
                transform: 'rotate(-7deg)',
                position: 'absolute',
                top: 30,
                left: 10,
                right: 30,
                bottom: 30,
                zIndex: 1
              }}
            />
            <div
              className="card card-lg"
              style={{
                background: 'var(--bg-elev)',
                transform: 'rotate(3deg)',
                position: 'relative',
                zIndex: 2,
                padding: 28,
                textAlign: 'center'
              }}
            >
              <span
                className="sticker tilt-l"
                style={{ background: 'var(--coral)', color: 'var(--paper)', position: 'absolute', top: -14, left: 18 }}
              >
                FRANSKA
              </span>
              <img
                src="/assets/star-sticker.svg"
                width="44"
                alt=""
                style={{ position: 'absolute', top: -18, right: -10, transform: 'rotate(18deg)', zIndex: 3 }}
              />
              <div className="t-hand muted" style={{ fontSize: 15, marginTop: 12 }}>Översätt till svenska</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 76, lineHeight: 1, margin: '14px 0' }}>
                maison
              </div>
              <input
                className="inp inp-lg"
                placeholder="skriv..."
                readOnly
                style={{ textAlign: 'center', fontSize: 18 }}
                aria-hidden="true"
                tabIndex={-1}
              />
              <div className="t-hand muted" style={{ fontSize: 13, marginTop: 8 }}>tryck enter för att svara</div>
            </div>
            <div style={{ position: 'absolute', right: -10, bottom: -32, zIndex: 3 }}>
              <GloAvatar size={120} float tilt={-8} />
            </div>
            <img
              src="/assets/sparkle.svg"
              width="28"
              alt=""
              style={{ position: 'absolute', left: -10, top: 60, transform: 'rotate(-12deg)', zIndex: 0 }}
            />
          </div>
        </div>
      </main>

      <section
        id="hur-funkar-det"
        style={{
          background: 'var(--paper-deep)',
          borderTop: '2px solid var(--ink)',
          borderBottom: '2px solid var(--ink)',
          padding: '64px 24px'
        }}
      >
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <h2 style={{ fontSize: 40, marginBottom: 36, textAlign: 'center' }}>
            Tre saker du <span className="mark-highlight">redan</span> kan göra
          </h2>
          <div className="features-grid">
            <div className="card card-lg tilt-l" style={{ background: 'var(--coral-soft)' }}>
              <div className="t-hand muted" style={{ fontSize: 14 }}>01</div>
              <h3 style={{ margin: '4px 0 10px' }}>Klistra in från Google Docs</h3>
              <p style={{ margin: 0 }}>
                Kopiera glosorna från din läxa, klistra in i Glosan. AI tolkar tabbar, streck eller tabeller och bygger en lista på sekunder.
              </p>
            </div>
            <div className="card card-lg tilt-r" style={{ background: 'var(--leaf-soft)' }}>
              <div className="t-hand muted" style={{ fontSize: 14 }}>02</div>
              <h3 style={{ margin: '4px 0 10px' }}>Öva på sex sätt</h3>
              <p style={{ margin: 0 }}>
                Flashkort, skriv översättningen, välj av fyra, glos-galge, ordfall eller orm-spel. Du växlar per session. Glo accepterar synonymer som "söt/gullig".
              </p>
            </div>
            <div className="card card-lg tilt-l" style={{ background: 'var(--sky-soft)' }}>
              <div className="t-hand muted" style={{ fontSize: 14 }}>03</div>
              <h3 style={{ margin: '4px 0 10px' }}>Glo håller koll</h3>
              <p style={{ margin: 0 }}>
                Mastery per glosa, rekord per lista, "öva bara fel"-läge, streak-räknare. Du ser direkt vad som behöver nötas in.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Sex spellägen */}
      <section style={{ padding: '64px 24px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <h2 style={{ fontSize: 40, marginBottom: 8, textAlign: 'center' }}>
            Sex sätt att <span className="mark-highlight">öva</span>
          </h2>
          <p className="t-hand muted" style={{ fontSize: 17, textAlign: 'center', margin: '0 0 36px' }}>
            Olika lägen för olika dagar. Tröttna aldrig.
          </p>
          <div className="features-grid">
            {GAMES.map((g) => (
              <div key={g.title} className="card card-lg" style={{ background: g.bg }}>
                <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">{g.icon}</div>
                <h3 style={{ margin: '0 0 8px' }}>{g.title}</h3>
                <p style={{ margin: 0, fontSize: 15 }}>{g.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tävla med kompisar */}
      <section
        style={{
          background: 'var(--paper-deep)',
          borderTop: '2px solid var(--ink)',
          borderBottom: '2px solid var(--ink)',
          padding: '64px 24px'
        }}
      >
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <h2 style={{ fontSize: 40, marginBottom: 8, textAlign: 'center' }}>
            Tävla med <span className="mark-highlight">kompisar</span>
          </h2>
          <p className="t-hand muted" style={{ fontSize: 17, textAlign: 'center', margin: '0 0 36px' }}>
            Plugg är roligare när någon hejar (eller hånar) ⚔️
          </p>
          <div className="features-grid">
            <div className="card card-lg tilt-l" style={{ background: 'var(--coral-soft)' }}>
              <div style={{ fontSize: 32, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">🤝</div>
              <h3 style={{ margin: '0 0 8px' }}>Dela listor</h3>
              <p style={{ margin: 0, fontSize: 15 }}>
                Dela en lista read-only eller med skrivrätt. Engångskoder så ingen sprider den vidare.
              </p>
            </div>
            <div className="card card-lg tilt-r" style={{ background: 'var(--mustard-soft)' }}>
              <div style={{ fontSize: 32, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">⚔️</div>
              <h3 style={{ margin: '0 0 8px' }}>Live-duell</h3>
              <p style={{ margin: 0, fontSize: 15 }}>
                Två kompisar, samma lista, samtidigt. Snabbast och bäst vinner. Sju olika utmaningstyper.
              </p>
            </div>
            <div className="card card-lg tilt-l" style={{ background: 'var(--leaf-soft)' }}>
              <div style={{ fontSize: 32, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">🏆</div>
              <h3 style={{ margin: '0 0 8px' }}>Leaderboards & streaks</h3>
              <p style={{ margin: 0, fontSize: 15 }}>
                Veckans rekord, månadens XP, längsta streak. Glo håller noggrann statistik.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Språkstöd */}
      <section style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p className="t-hand muted" style={{ fontSize: 16, margin: '0 0 12px' }}>
            Dedikerade flaggor och röst-uttal för:
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
            <Flag code="fr" size="lg" />
            <Flag code="de" size="lg" />
            <Flag code="es" size="lg" />
            <Flag code="uk" size="lg" />
            <Flag code="se" size="lg" />
          </div>
          <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>
            … plus alla språkpar du själv vill skapa
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section
        style={{
          background: 'var(--paper-deep)',
          borderTop: '2px solid var(--ink)',
          borderBottom: '2px solid var(--ink)',
          padding: '64px 24px'
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h2 style={{ fontSize: 40, marginBottom: 28, textAlign: 'center' }}>
            Vanliga <span className="mark-highlight">frågor</span>
          </h2>
          <div className="stack">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="card"
                style={{ background: 'var(--bg-elev)', cursor: 'pointer' }}
              >
                <summary style={{ fontWeight: 800, fontSize: 18, listStyle: 'none', position: 'relative', paddingRight: 28 }}>
                  {item.q}
                  <span aria-hidden="true" style={{ position: 'absolute', right: 0, top: 0, fontSize: 20 }}>＋</span>
                </summary>
                <p style={{ margin: '12px 0 0', fontSize: 16, lineHeight: 1.5 }}>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div className="row" style={{ justifyContent: 'center', marginBottom: 18 }}>
            <GloAvatar size={120} float mood="wink" />
          </div>
          <h2 style={{ fontSize: 36, marginBottom: 10 }}>Redo att börja?</h2>
          <p className="t-hand muted" style={{ fontSize: 17, marginBottom: 22 }}>
            Glo väntar. 30 sekunder att skapa konto, första listan klar på en minut.
          </p>
          <Link to="/register">
            <button className="btn btn-primary btn-lg">Skapa konto — gratis →</button>
          </Link>
        </div>
      </section>

      <footer style={{ borderTop: '2px solid var(--ink)', padding: '20px 24px', background: 'var(--paper)' }}>
        <div className="row between" style={{ maxWidth: 1080, margin: '0 auto', flexWrap: 'wrap', gap: 12 }}>
          <span className="t-hand muted" style={{ fontSize: 14 }}>© Glosan · pluggets gladaste hörn</span>
          <div className="row" style={{ gap: 18 }}>
            <Link to="/login" className="t-hand" style={{ fontSize: 14 }}>Logga in</Link>
            <Link to="/register" className="t-hand" style={{ fontSize: 14 }}>Skapa konto</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
