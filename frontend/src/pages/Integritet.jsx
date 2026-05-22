import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import { useDocumentTitle } from '../utils/useDocumentTitle';

// Integritetspolicy. Personuppgiftsansvarig + kontaktuppgifter ska
// fyllas i av Majkens vårdnadshavare innan publik produktion.
const LAST_UPDATED = '2026-05-21';
const CONTACT_EMAIL = 'info@glosan.app';
const CONTROLLER_NAME = 'Glosan';

export default function Integritet() {
  useDocumentTitle('Integritetspolicy');
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <Helmet>
        <title>Integritetspolicy — Glosan</title>
        <meta name="description" content="Så här behandlar Glosan dina personuppgifter. GDPR-kompatibel, transparent och med möjlighet att exportera eller radera ditt konto när som helst." />
        <link rel="canonical" href="https://glosan.app/integritet" />
      </Helmet>
      <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <GloAvatar size={72} float tilt={-4} />
        <div>
          <div className="t-hand muted" style={{ fontSize: 16 }}>Glosan</div>
          <h1 style={{ margin: '2px 0 0' }}>Integritetspolicy</h1>
        </div>
      </div>
      <p className="t-hand muted" style={{ fontSize: 15, marginBottom: 24 }}>
        Senast uppdaterad: {LAST_UPDATED}. Den här texten beskriver vilka personuppgifter Glosan
        behandlar, varför, och vilka rättigheter du har. Glo försöker hålla det enkelt.
      </p>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Personuppgiftsansvarig</h2>
        <p>
          {CONTROLLER_NAME} är personuppgiftsansvarig.{' '}
          {CONTACT_EMAIL
            ? <>Kontakt: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</>
            : 'Kontaktuppgifter uppdateras inom kort.'}
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Vilka uppgifter behandlar vi?</h2>
        <ul>
          <li><strong>Kontouppgifter:</strong> användarnamn, e-postadress, lösenord (lagras hashat med bcrypt — vi ser aldrig ditt lösenord i klartext), valfri avatar.</li>
          <li><strong>Innehåll du skapar:</strong> glos­listor, glosor och anteckningar. Listor kan delas med kompisar (read-only eller med redigerings­rätt) och kopieras till deras egna konton.</li>
          <li><strong>Användningsstatistik:</strong> XP-totalt + per språk, streak, antal genomförda quiz, perfekta rundor, antal AI-anrop denna månad. Loggas för leaderboards och rekord.</li>
          <li><strong>Händelse­logg per quiz-runda</strong> (<em>QuizRunEvent</em>): vilken lista, antal rätt/fel, tidpunkt — driver "veckans rekord".</li>
          <li><strong>XP-event­logg</strong> (<em>XpEvent</em>): varje XP-utdelning med språk och tidpunkt — driver "månadens XP".</li>
          <li><strong>Engångskoder</strong> (<em>InviteCode</em>): 8 tecken, går ut efter 7 dagar och kan användas en gång. Vi lagrar vem som löste in koden tills den går ut.</li>
          <li><strong>Kompis­relationer</strong> (<em>Friendship</em>): vilka konton som lagt till varandra. Inga meddelanden eller chattar.</li>
          <li><strong>Co-op-streaks</strong> (<em>CoopStreak</em>): gemensam streak per kompis-par och senaste dagen ni båda var aktiva.</li>
          <li><strong>Utmaningar</strong> (<em>Duel</em>): async-, mål- eller live-duells du deltagit i, inklusive snapshot av frågorna och varje deltagares resultat (rätt/total/tid). Live-duells visar tillfälligt din avatar och dina svar för motspelaren i realtid över WebSocket.</li>
          <li><strong>Tekniska detaljer:</strong> en httpOnly-cookie med en hashad refresh-token som håller dig inloggad i upp till 7 dagar.</li>
        </ul>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Varför behandlar vi dem?</h2>
        <ul>
          <li><strong>Avtal:</strong> för att kunna leverera tjänsten — spara dina glosor, visa din profil, räkna XP och köra quizen.</li>
          <li><strong>Berättigat intresse:</strong> säkerhet (rate-limiting, fel-spårning), grundläggande funktion och anonym besöks­statistik för att förstå vilka delar av appen som används.</li>
        </ul>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>AI-funktioner och tredjepart</h2>
        <p>
          När du använder Glo-funktionerna (generera glosor, översätta, exempel­meningar, importera text)
          skickas det du skriver in till <strong>Anthropic</strong> (USA) som driver språkmodellen Claude.
          Vi skickar inte ditt användarnamn eller e-postadress — bara texten som behövs för uppgiften.
        </p>
        <p>
          Eftersom Anthropic är USA-baserat innebär det en överföring av personuppgifter utanför EU/EES.
          Vill du undvika det, använd inte AI-funktionerna — appens grundläggande funktioner (skapa glosor manuellt,
          quiz, flashkort, galge, ordfall) fungerar utan dem.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Cookies och spårning</h2>
        <p>Vi använder så få cookies som möjligt:</p>
        <ul>
          <li><strong>refreshToken</strong> (httpOnly, strikt nödvändig): håller dig inloggad i upp till 7 dagar. Krävs för att tjänsten ska fungera och omfattas inte av samtyckes­kravet i ePrivacy.</li>
          <li><strong>Lokal lagring i webbläsaren</strong>: små funktions­inställningar som vilket övnings­läge du valde senast — sparas bara hos dig och skickas aldrig till oss.</li>
        </ul>
        <p>
          Vi använder <strong>Umami</strong> för anonym besöks­statistik. Umami körs på vår egen server,
          sätter inga cookies, och spårar inte över sajter — den räknar bara sidvisningar och har
          en daglig roterande hash för att gissa unika besökare. Det är därför du inte ser någon
          cookie-popup på Glosan.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Barn under 13 år</h2>
        <p>
          Glosan är avsedd för användare som är minst 13 år. Vid registreringen
          måste man bekräfta sin ålder, eller att man har en förälders eller
          vårdnadshavares tillåtelse att skapa kontot.
        </p>
        <p>
          Är du förälder och har frågor om ditt barns konto — eller vill du
          radera eller exportera ditt barns data å hens vägnar — använd
          knapparna på barnets profilsida eller hör av dig till oss på
          adressen längst ned. Vi rekommenderar att läsa igenom den här
          policyn tillsammans med barnet.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Hur länge sparas dina uppgifter?</h2>
        <p>
          Allt sparas tills du själv raderar det. Du kan när som helst radera enstaka glosor, listor och kompisar — eller
          hela kontot från profilsidan.
        </p>
        <p>
          När du raderar ditt konto tas följande bort omedelbart: kontouppgifter, dina egna listor + glosor, kompis­
          relationer, co-op-streaks, utmaningar du deltagit i, XP- och quiz-runda-historik samt aktiva engångskoder.
          Du tas också automatiskt bort från andras "delade med dig"-sektion.
        </p>
        <p className="t-hand muted" style={{ fontSize: 14 }}>
          Påverkan på andra: kompisar som hade dina delade listor förlorar tillgången, utmaningar mellan dig och dem
          försvinner, och co-op-streaks ni delade upphör. De ser inget av ditt användarnamn eller avatar längre.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Dina rättigheter</h2>
        <ul>
          <li><strong>Tillgång + dataportabilitet:</strong> ladda ner allt vi har om dig som JSON från din <Link to="/profile">profil</Link>.</li>
          <li><strong>Rättelse:</strong> ändra dina uppgifter eller ditt innehåll när som helst.</li>
          <li><strong>Radering:</strong> radera ditt konto från profilen — alla dina uppgifter försvinner direkt.</li>
          <li><strong>Invändning mot statistik:</strong> hör av dig till oss om du inte vill ingå i den anonyma besöks­statistiken så ordnar vi det manuellt.</li>
          <li><strong>Klagomål:</strong> du har rätt att klaga till Integritets­skydds­myndigheten (IMY) om du tycker vi hanterar dina uppgifter fel.</li>
        </ul>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Säkerhet</h2>
        <ul>
          <li>All trafik går över HTTPS.</li>
          <li>Lösenord lagras med bcrypt (cost 12).</li>
          <li>Refresh-tokens lagras hashade i databasen — aldrig i klartext.</li>
          <li>Rate-limiting på inloggning, AI-anrop och övriga skrivningar.</li>
        </ul>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Ändringar av denna policy</h2>
        <p>Om vi ändrar något väsentligt uppdaterar vi datumet längst upp och meddelar inloggade användare nästa gång de besöker sidan.</p>
      </section>

      <p className="t-hand muted" style={{ fontSize: 14 }}>
        {CONTACT_EMAIL
          ? <>Frågor? Maila <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</>
          : 'Frågor? Kontaktuppgifter uppdateras inom kort.'}
      </p>
    </div>
  );
}
