import { useState, useRef } from "react";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { useNavigate } from "react-router-dom";
import heroImage from "../assets/projects-2.jpg";
import { secureCallable } from "../services/security/secureCallable";
import Footer from "../components/layout/Footer";
import "./public.css";

export default function Register() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const toast = useRef<Toast>(null);
  const navigate = useNavigate();

  const handleRegister = async () => {
    if (!email) {
      toast.current?.show({
        severity: "warn",
        summary: "Email mancante",
        detail: "Inserisci un indirizzo email valido.",
        life: 3000,
      });
      return;
    }

    setLoading(true);

    try {
      await secureCallable(
        "register",
        {
          email,
        },
        "register_email"
      );

      setSubmitted(true);
      setEmail("");
      setTimeout(() => window.location.replace("/login"), 5000);
    } catch (err: unknown) {
      console.error("Registration error:", err);
      let errorMessage = "Registrazione fallita. Riprova.";
      if (
        err &&
        typeof err === "object" &&
        "message" in err &&
        typeof (err as { message?: unknown }).message === "string"
      ) {
        errorMessage = (err as { message: string }).message;
      }
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: errorMessage,
        life: 4000,
      });
    } finally {
      setLoading(false);
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

      <main className="pub-main pub-narrow">
        <h1 className="pub-title">Registrazione</h1>
        <p className="pub-lead">
          Inserisci la tua email per ricevere il link di conferma e completare l&apos;accesso al
          portale volontari.
        </p>
        <p className="pub-lead" style={{ marginTop: 8 }}>
          Se hai già un account,{" "}
          <button type="button" className="pub-link-btn" onClick={() => navigate("/login")}>
            torna alla login
          </button>
          .
        </p>

        {!submitted ? (
          <form
            className="pub-stack p-fluid"
            style={{ marginTop: 32, maxWidth: 420 }}
            onSubmit={(e) => {
              e.preventDefault();
              handleRegister();
            }}
          >
            <label htmlFor="register-email" className="pub-sr">
              Email
            </label>
            <InputText
              id="register-email"
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            <Button
              type="submit"
              label={loading ? "Invio in corso..." : "Invia la richiesta"}
              className="pub-btn-primary"
              disabled={loading || !email}
            />
            <Button
              type="button"
              label="Torna alla login"
              className="pub-btn-outline"
              onClick={() => navigate("/login")}
              disabled={loading}
            />
          </form>
        ) : (
          <div className="pub-success" role="status">
            <h2>Controlla la tua email</h2>
            <p>
              Segui le istruzioni ricevute per completare la registrazione. Se non vedi il messaggio
              entro pochi minuti, controlla anche la cartella spam.
            </p>
            <p>Verrai reindirizzato alla login tra pochi secondi.</p>
            <Button
              type="button"
              label="Vai alla login"
              className="pub-btn-outline"
              onClick={() => navigate("/login")}
            />
          </div>
        )}

        <div className="pub-brandbar">
          <span className="pub-brandbar-meta">
            Registrazione · v{__APP_VERSION__} · Aggiornata al {__BUILD_DATE__}
          </span>
        </div>
      </main>

      <Footer />
    </div>
  );
}
