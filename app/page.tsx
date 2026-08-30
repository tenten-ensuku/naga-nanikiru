import { APP_BASE_PATH } from "./lib/appIdentity";

export default function Home() {
  return (
    <main className="prototype-shell">
      <iframe
        className="prototype-frame"
        src={`${APP_BASE_PATH}index.html`}
        title="みん切る｜みんなの何切る問題集"
      />
    </main>
  );
}
