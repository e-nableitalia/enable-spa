import { useRef, useState } from "react";
import logo from "../assets/logo.png";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, functions, googleProvider } from "../firebase";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { useNavigate } from "react-router-dom";
import { Toast } from "primereact/toast";
import { httpsCallable } from "firebase/functions";

import Footer from "../components/layout/Footer";

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
      // Usa un toast per il messaggio di errore
      // Assicurati di importare e configurare il Toast di PrimeReact
      // Aggiungi una ref per il toast
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
    <div style={{ maxWidth: 600, margin: "10px auto" }}>
      <div style={{ maxWidth: 600, margin: "36px auto" }}>
        <Toast ref={toast} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            marginBottom: 24,
            justifyContent: "center",
            background: "linear-gradient(135deg, #e6f7ff 60%, #fff 100%)",
            borderRadius: 12,
            boxShadow: "0 4px 16px rgba(0,80,179,0.08)",
            padding: "32px 16px",
          }}
        >
          <img
            src={logo}
            alt="Logo"
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              boxShadow: "0 2px 8px rgba(0,80,179,0.12)",
              marginBottom: 8,
              background: "#fff",
            }}
          />
          <h2 style={{
            fontWeight: 700,
            color: "#0050b3",
            margin: 0,
            fontSize: "2em",
            letterSpacing: "0.02em",
          }}>
            e-Nable Italia
          </h2>
          <h3 style={{
            color: "#888",
            textAlign: "center",
            margin: "8px 0 0 0",
            fontWeight: 500,
            fontSize: "1.15em",
            letterSpacing: "0.01em",
          }}>
            Portale di Accesso Volontari
          </h3>
        </div>
        <div
          style={{
            background: "#e6f7ff",
            border: "1px solid #91d5ff",
            borderRadius: 6,
            padding: "8px 16px",
            marginTop: 8,
            color: "#0050b3",
            fontWeight: 500,
            fontSize: "1.1em",
            textAlign: "center",
            width: "100%"
          }}
        >
          <span>
            Benvenuto nel portale dedicato ai volontari della community di<br /> 
            e-Nable Italia!<br />
            <a
              href="https://e-nableitalia.it"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "underline", color: "#0050b3" }}
            >
              Visita il sito ufficiale
            </a>
          </span>
        </div>
      </div>
      <div className="p-fluid" style={{ maxWidth: 400, margin: "0 auto" }}>
        <InputText
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3"
        />
        <InputText
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3"
        />
        <Button label="Login" onClick={handleLogin} />
        <div style={{ textAlign: "center", margin: "16px 0" }}>
          <span>Oppure accedi con il tuo account Google</span>
        </div>
        <Button
          label="Continua con Google"
          icon="pi pi-google"
          onClick={handleGoogleLogin}
          className="p-button-danger w-full"
        />
      </div>

      <div className="login-info-message" style={{ marginTop: 12, background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 6, padding: 16, color: "#614700" }}>
        <strong style={{ display: "block", textAlign: "center" }}>Accesso Volontari</strong><br />
        Questo portale è riservato ai volontari della community e-Nable Italia.<br /><br />

        Chiunque desideri entrare a farne parte può farlo, a condizione di conoscere e accettare le regole della community e il relativo codice etico.
        Tutte le informazioni per i volontari sono disponibili alla pagina dedicata:
        <a
          href="https://e-nableitalia.it/it_it/informazioni-volontari/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline" }}
        >
          Informazioni per i volontari
        </a>.<br /><br />


        <span style={{ fontStyle: "italic" }}>
          Puoi accedere con <b>le tue credenziali</b> oppure utilizzando <b>Google</b>.<br /><br />
          Se non sei ancora registrato, puoi creare un account in modo semplice:
          accedendo con <b>"Continua con Google"</b> (registrazione automatica)
          oppure via mail richiedendo il{" "}
          <b
            style={{ cursor: "pointer", textDecoration: "underline" }}
            onClick={() => navigate("/register")}
          >
            link di registrazione nuovo utente
          </b>.
          <br /><br />
          Se invece sei arrivato qui per richiedere un device, non è necessario registrarsi:
          puoi farlo direttamente cliccando sul pulsante <b>"Voglio richiedere un device"</b> qui sotto.
        </span>
      </div>
      <div style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          label="Voglio richiedere un device"
          icon="pi pi-users"
          className="p-button-info"
          onClick={() => navigate("/request-device")}
        />
      </div>
      <Footer />
    </div>
  );
}
