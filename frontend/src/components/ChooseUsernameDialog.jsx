import { useAuth } from '../contexts/AuthContext';
import GloAvatar from './GloAvatar';
import UsernameForm from './UsernameForm';

// Första inloggningen med Google: namnet togs ur e-posten (ofta skolans), så
// användaren får välja ett eget — förslaget står redan i rutan, och sparar man
// det oförändrat behålls det. Visas av Layout så länge user.needsUsername.
// Ingen stängknapp: ett val behövs, men det räcker att trycka Spara.
export default function ChooseUsernameDialog() {
  const { user } = useAuth();
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" aria-labelledby="choose-username-title">
        <div className="modal-header">
          <h3 id="choose-username-title" style={{ margin: 0 }}>Välj ditt användarnamn</h3>
        </div>
        <div className="modal-body stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <GloAvatar size={56} mood="wink" tilt={-6} />
            <p style={{ margin: 0 }}>
              Det är så dina kompisar ser dig i Glosan. Vi har föreslagit ett från din e-post — ändra det om du vill.
              Du kan byta det senare under Profil.
            </p>
          </div>
          <UsernameForm initial={user?.username} submitLabel="Spara" />
        </div>
      </div>
    </div>
  );
}
