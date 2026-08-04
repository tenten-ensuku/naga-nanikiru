import { APP_BASE_PATH } from "./lib/appIdentity";

export default function Home() {
  return (
    <main className="prototype-shell">
      <iframe
        className="prototype-frame"
        src={`${APP_BASE_PATH}index.html`}
        title="NAGA局面ドリル｜スクリーンショットベース"
      />
    </main>
  );
}
