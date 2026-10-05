import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { hasFeature } from '../utils/features';
import { fetchMcpEndpoint } from '../api/mcp';

// /koppla-ai — guiden till att koppla sin egen AI (Claude m.fl.) till Glosan
// via MCP. Publik, så man kan läsa den innan man har ett konto; inloggad visas
// den i Layout. Plugga-innehåll skapas bara så (docs/plugga.md), så det här är
// vägen in för alla som vill skapa egna områden. Tekniken: docs/mcp.md.

function CopyAddress({ endpoint }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-API:t kan saknas — adressen står ju där att markera.
    }
  };
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <code
        style={{
          background: 'var(--paper-edge)',
          padding: '8px 12px',
          borderRadius: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 15,
          wordBreak: 'break-all'
        }}
      >
        {endpoint}
      </code>
      <button className="btn btn-sm" type="button" onClick={onCopy}>{copied ? 'Kopierad ✓' : 'Kopiera'}</button>
    </div>
  );
}

function Example({ photo, children }) {
  return (
    <li style={{ marginBottom: 6 }}>
      {photo ? <span aria-label="med ett foto">📷 </span> : <span aria-hidden="true">💬 </span>}
      <em>&quot;{children}&quot;</em>
    </li>
  );
}

function Guide({ loggedIn, hasPlugga = false }) {
  const [endpoint, setEndpoint] = useState(`${window.location.origin}/api/mcp`);
  useEffect(() => {
    let alive = true;
    fetchMcpEndpoint().then((e) => { if (alive) setEndpoint(e); });
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <GloAvatar size={72} float mood="wink" tilt={-4} />
        <div>
          <div className="t-hand muted" style={{ fontSize: 16 }}>Guide</div>
          <h1 style={{ margin: '2px 0 0' }}>Koppla din AI till Glosan</h1>
        </div>
      </div>
      <p style={{ fontSize: 18, marginTop: 0 }}>
        Med din egen AI — till exempel Claude — kan du fota glosläxan eller sidorna i boken och få allt inlagt
        i Glosan: glosor att öva på och, i <strong>Plugga</strong>, genomgångar, kort, övningar och övningsprov.
        Du kopplar ihop dem en gång, sedan räcker det att be din AI.
      </p>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Det här behöver du</h2>
        <ul style={{ lineHeight: 1.6 }}>
          <li>Ett Glosan-konto (gratis).</li>
          <li>
            En AI som kan koppla in en <em>MCP-server</em> — det kallas ofta en <em>connector</em>. Claude kan det,
            även gratisversionen (där får du ha en egen connector).
          </li>
          <li>Glosans adress, som du klistrar in i din AI:</li>
        </ul>
        <CopyAddress endpoint={endpoint} />
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Så kopplar du Claude</h2>
        <ol style={{ lineHeight: 1.7, paddingLeft: 22, margin: 0 }}>
          <li>
            Öppna <strong>claude.ai</strong> i webbläsaren (eller Claude-appen på datorn) och gå till{' '}
            <strong>Customize → Connectors</strong> (i äldre versioner <strong>Settings → Connectors</strong>).
          </li>
          <li>
            Välj <strong>Add custom connector</strong> (ibland under <strong>+ Add</strong>). Skriv <em>Glosan</em> som
            namn och klistra in adressen ovan.
          </li>
          <li>
            Frågar Claude hur den ska logga in: välj <strong>Sign in now</strong> under <em>Authentication</em> och{' '}
            <strong>Register automatically</strong> under <em>OAuth client</em>. (Claude föreslår{' '}
            <em>Claude&apos;s published identity</em> — det fungerar inte med Glosan än.)
          </li>
          <li>
            Klicka <strong>Add</strong> (och <strong>Connect</strong> om Claude visar den knappen). Glosan öppnas:
            logga in och välj vad AI:n får göra. Välj <strong>Läsa och skapa</strong> om den ska kunna lägga in
            glosor och områden åt dig, och klicka <strong>Godkänn</strong>.
          </li>
          <li>
            Klart! I en chatt: tryck på <strong>+</strong> → <strong>Connectors</strong> och se till att Glosan är
            påslaget.
          </li>
        </ol>
        <p className="t-hand muted" style={{ fontSize: 15, margin: '12px 0 0' }}>
          📱 I mobilen: lägg till Glosan på claude.ai eller i datorappen först — sedan finns den i Claude-appen
          i mobilen också, med samma Claude-konto.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Andra AI:er</h2>
        <p style={{ margin: 0 }}>
          ChatGPT och andra AI:er som kan koppla in MCP-servrar fungerar på samma sätt: lägg till adressen ovan och
          logga in i Glosan när du blir tillfrågad. Var inställningen finns skiljer sig mellan tjänster och
          abonnemang.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Det här kan du säga till din AI</h2>
        <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>Glosor</h3>
        <ul style={{ listStyle: 'none', paddingLeft: 0, margin: '0 0 14px' }}>
          <Example photo>Gör en glosa av det här i Glosan.</Example>
          <Example>Lägg till exempelmeningar i min lista med franska verb.</Example>
          <Example>Öva med mig på glosorna jag har svårast för.</Example>
        </ul>
        <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>Plugga</h3>
        <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
          <Example photo>Hjälp mig plugga på det här i Glosan.</Example>
          <Example>Jag har prov på kapitel 4 på fredag — gör ett övningsprov.</Example>
          <Example photo>Rätta min lösning på MA1-14.</Example>
          <Example photo>Rätta mitt övningsprov.</Example>
        </ul>
        <p className="t-hand muted" style={{ fontSize: 15, margin: '12px 0 0' }}>
          När du gör ett nytt område frågar AI:n först vilken årskurs du går i och föreslår vad den ska lägga in.
          Uppgifter i boken används bara som förebilder — du får egna uppgifter på samma nivåer.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Vad ser AI:n?</h2>
        <ul style={{ lineHeight: 1.6, margin: 0 }}>
          <li>
            Dina listor, glosor, Plugga-områden och resultat i Glosan, och vilka kompisar du har och delar med — aldrig
            ditt lösenord eller din e-post.
          </li>
          <li>
            Du väljer själv om den bara får <strong>läsa</strong> eller också <strong>skapa och ändra</strong>. Då kan den
            också dela med dina kompisar och göra delningslänkar — Glosan säger åt den att bara göra det när du ber om
            det, och att fråga dig först.
          </li>
          <li>
            Foton du skickar till AI:n når aldrig Glosan: AI:n läser bilden själv och lägger bara in texten. Glosan
            ser inte heller dina chattar.
          </li>
          <li>
            Du kopplar bort AI:n när som helst under{' '}
            {loggedIn ? <Link to="/profile">Profil → Koppla din AI</Link> : <strong>Profil → Koppla din AI</strong>}.
          </li>
        </ul>
      </section>

      <section className="card" id="hjalp" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Om något strular</h2>
        <dl style={{ margin: 0, lineHeight: 1.5 }}>
          <dt><strong>Claude använder inte Glosan</strong></dt>
          <dd style={{ margin: '2px 0 12px' }}>Tryck på <strong>+</strong> → <strong>Connectors</strong> i chatten och slå på Glosan.</dd>
          <dt><strong>&quot;Glosan kände inte igen din AI&quot;</strong></dt>
          <dd style={{ margin: '2px 0 12px' }}>
            Ta bort Glosan under <strong>Customize → Connectors</strong> och lägg till den igen — och välj{' '}
            <strong>Register automatically</strong> under <em>OAuth client</em>.
          </dd>
          <dt><strong>AI:n når inte Plugga</strong></dt>
          <dd style={{ margin: '2px 0 12px' }}>
            Kopplade du den innan Plugga fanns för alla? Då godkände du bara glosorna. Koppla bort den under
            Profil → Koppla din AI och anslut igen från din AI (i Claude: <strong>Customize → Connectors</strong> →
            Glosan → <strong>Connect</strong>).
          </dd>
          <dt><strong>AI:n kan bara läsa</strong></dt>
          <dd style={{ margin: '2px 0 12px' }}>
            Du valde &quot;Bara läsa&quot; när du godkände. Koppla bort och anslut igen, och välj <strong>Läsa och skapa</strong>.
          </dd>
          <dt><strong>Ingen egen AI?</strong></dt>
          <dd style={{ margin: '2px 0 0' }}>
            Du kan ändå öva: gör glosor direkt i Glosan, och be en kompis dela ett Plugga-område med dig
            (<em>👥 Dela</em> → QR-kod) — du får en egen kopia.
          </dd>
        </dl>
      </section>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center', margin: '8px 0 24px' }}>
        {loggedIn ? (
          <>
            <Link to="/profile"><button className="btn btn-primary" type="button">Till Profil → Koppla din AI</button></Link>
            {hasPlugga && <Link to="/plugga"><button className="btn" type="button">Till Plugga</button></Link>}
          </>
        ) : (
          <>
            <Link to="/register"><button className="btn btn-primary" type="button">Skapa konto — gratis</button></Link>
            <Link to="/login"><button className="btn" type="button">Logga in</button></Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConnectAiGuide() {
  useDocumentTitle('Koppla din AI');
  const { user } = useAuth();
  const head = (
    <Helmet>
      <title>Koppla din AI till Glosan — Glosan</title>
      <meta name="description" content="Så kopplar du Claude eller en annan AI till Glosan, så att den kan göra glosor och Plugga-områden åt dig från ett foto." />
      <link rel="canonical" href="https://glosan.app/koppla-ai" />
    </Helmet>
  );
  if (user) return <>{head}<Guide loggedIn hasPlugga={hasFeature(user, 'study')} /></>;
  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      {head}
      <nav className="navbar" style={{ background: 'transparent', borderBottom: 'none' }}>
        <div className="nav-inner">
          <Link to="/"><img src="/assets/logo-wordmark.svg" height={44} alt="Glosan" /></Link>
          <div className="row" style={{ gap: 12 }}>
            <Link to="/login"><button className="btn btn-sm btn-ghost" type="button">Logga in</button></Link>
          </div>
        </div>
      </nav>
      <main style={{ padding: '16px 16px 48px' }}>
        <Guide loggedIn={false} />
      </main>
    </div>
  );
}
