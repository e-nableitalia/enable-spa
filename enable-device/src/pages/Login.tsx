import { useRef, useState } from "react";
import heroImage from "../assets/projects-2.jpg";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, functions, googleProvider } from "../firebase";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { useNavigate } from "react-router-dom";
import { Toast } from "primereact/toast";
import { httpsCallable } from "firebase/functions";

import Footer from "../components/layout/Footer";
import "./public.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const toast = useRef<Toast>(null);

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      const doLogin = httpsCallable(functions, "doLogin");
      await doLogin();
      navigate("/home");
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Login error",
        life: 3000,
      });
      console.error(err);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);

      // user auto provisioning on backend
      const autoprovisioning = httpsCallable(functions, "registerWithIntegratedAuth");
      await autoprovisioning();

      navigate("/home");
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Login error",
        life: 3000,
      });
      console.error(err);
    }
  };

  return (
    <div className="pub">
      <Toast ref={toast} />

      <img
        className="pub-hero"
        src={heroImage}
        alt="Mano robotica che tocca il logo e-Nable Italia"
      />

      <main className="pub-main">
        <h1 className="pub-title">Una mano, progettata insieme.</h1>
        <p className="pub-lead">
          Benvenuto nel portale della community di e-Nable Italia: volontari che progettano e
          realizzano gratuitamente device assistivi per bambini e adulti.{" "}
          <a href="https://e-nableitalia.it" target="_blank" rel="noopener noreferrer">
            Visita il sito ufficiale
          </a>
        </p>

        <div className="pub-cols">
          <section className="pub-section" aria-labelledby="request-title">
            <h2 id="request-title">Devi richiedere un device?</h2>
            <p>
              Non è necessario registrarsi. Compila il modulo di richiesta: i nostri volontari ti
              ricontatteranno via email.
            </p>
            <Button
              label="Voglio richiedere un device"
              icon="pi pi-arrow-right"
              iconPos="right"
              className="pub-btn-primary"
              onClick={() => navigate("/request-device")}
            />
          </section>

          <section className="pub-section" aria-labelledby="login-title">
            <h2 id="login-title">Accesso volontari</h2>
            <form
              className="pub-stack p-fluid"
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin();
              }}
            >
              <Button
                type="button"
                label="Accedi con Google"
                icon="pi pi-google"
                className="pub-btn-outline"
                onClick={handleGoogleLogin}
              />
              <div className="pub-divider">oppure con le tue credenziali</div>
              <label htmlFor="login-email" className="pub-sr">
                Email
              </label>
              <InputText
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="login-password" className="pub-sr">
                Password
              </label>
              <InputText
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" label="Login" className="pub-btn-primary" />
            </form>
          </section>
        </div>

        <div className="pub-notes">
          <div>
            <h3>Registrazione e accesso</h3>
            <p>
              Puoi accedere con il tuo account <b>Google</b> o con <b>le tue credenziali</b>.
            </p>
            <p>
              Se non sei ancora registrato, accedi con <b>"Accedi con Google"</b>{" "}
              <i>(registrazione automatica)</i> oppure via mail dalla{" "}
              <button type="button" className="pub-link-btn" onClick={() => navigate("/register")}>
                pagina di registrazione
              </button>{" "}
              <i>(ti verrà inviato un link di conferma via mail)</i>.
            </p>
          </div>
          <div>
            <h3>Richieste device</h3>
            <p>
              Se sei arrivato qui per richiedere un device, non è necessario registrarsi: usa il
              pulsante <b>"Voglio richiedere un device"</b>.
            </p>
          </div>
          <div>
            <h3>Portale Volontari e-Nable Italia</h3>
            <p>Questo portale è riservato ai volontari della community e-Nable Italia.</p>
            <p>
              Chiunque desideri entrare a farne parte può farlo, a condizione di conoscere e
              accettare le regole della community e il relativo codice etico. Leggi prima le{" "}
              <a
                href="https://e-nableitalia.it/it_it/informazioni-volontari/"
                target="_blank"
                rel="noopener noreferrer"
              >
                informazioni per i volontari
              </a>
              .
            </p>
          </div>
        </div>

        <div className="pub-brandbar">
          <span className="pub-brandbar-meta">
            Portale Volontari · v{__APP_VERSION__} · Aggiornata al {__BUILD_DATE__}
          </span>
        </div>
      </main>

      <Footer />
    </div>
  );
}
