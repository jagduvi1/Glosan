import { useAuth } from '../contexts/AuthContext';
import { useModalFocus } from '../utils/modalFocus';
import GloAvatar from './GloAvatar';
import UsernameForm from './UsernameForm';

// Första inloggningen med Google: namnet togs ur e-posten (ofta skolans), så
// användaren får välja ett eget — förslaget står redan i rutan, och sparar man
// det oförändrat behålls det. Visas av Layout så länge user.needsUsername.
// Ingen stängknapp (ett val behövs), men man kan alltid logga ut — dialogen
// täcker menyn, och på en delad skoldator ska nästa elev kunna logga in.
const stayOpen = () => {};

export default function ChooseUsernameDialog() {
  const { user, logout } = useAuth();
  const ref = useModalFocus(stayOpen); // fokus stannar i dialogen; Escape stänger inte
  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" aria-labelledby="choose-username-title">
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
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => logout({ thenGoTo: '/login' })}
          >
            Logga ut
          </button>
        </div>
      </div>
    </div>
  );
}
