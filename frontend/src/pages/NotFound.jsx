import { Link } from 'react-router-dom';
import GloAvatar from '../components/GloAvatar';
import { useDocumentTitle } from '../utils/useDocumentTitle';

export default function NotFound() {
  useDocumentTitle('Sidan finns inte');
  return (
    <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
      <GloAvatar size={140} float mood="sad" style={{ margin: '0 auto 16px' }} />
      <h1 style={{ marginBottom: 6 }}>Här vandrade Glo vilse.</h1>
      <p className="t-hand muted" style={{ fontSize: 16, margin: '0 0 18px' }}>
        Sidan finns inte. Tryckte du fel länk, eller har vi flyttat något?
      </p>
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <Link to="/lists"><button className="btn btn-primary">Till mina listor</button></Link>
        <Link to="/kompisar"><button className="btn">Till kompisar</button></Link>
      </div>
    </div>
  );
}
