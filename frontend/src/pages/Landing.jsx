import { Link } from 'react-router-dom';
import GloAvatar from '../components/GloAvatar';
import Sparkle from '../components/Sparkle';

export default function Landing() {
  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <nav className="navbar" style={{ background: 'transparent', borderBottom: 'none' }}>
        <div className="nav-inner">
          <img src="/assets/logo-wordmark.svg" height={44} alt="Glosan" />
          <div className="row" style={{ gap: 12 }}>
            <Link to="/login"><button className="btn btn-sm btn-ghost">Logga in</button></Link>
            <Link to="/register"><button className="btn btn-sm btn-primary">Hoppa in — gratis</button></Link>
          </div>
        </div>
      </nav>

      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px 80px' }}>
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
              Klistra in glosorna från din läxa — Glo tolkar formatet, bygger listan och nöter med dig. Tre quiz-lägen. Inga annonser. Inget rotande i menyer.
            </p>
            <div className="row" style={{ gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <Link to="/register"><button className="btn btn-primary btn-lg">Börja öva nu →</button></Link>
              <a href="#hur-funkar-det" style={{ textDecoration: 'none', color: 'inherit' }}>
                <button className="btn btn-lg">Hur funkar det?</button>
              </a>
            </div>
            <p className="t-hand muted" style={{ fontSize: 15 }}>
              Self-hosted MERN. Din data, din server, din vinst.
            </p>
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
      </section>

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
              <h3 style={{ margin: '4px 0 10px' }}>Öva på tre sätt</h3>
              <p style={{ margin: 0 }}>
                Skriv översättningen, välj av fyra, eller bara nöt med flashkort. Du växlar per session. Glo accepterar synonymer som "söt/gullig".
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
