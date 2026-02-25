import { useState, useRef } from "react";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { useNavigate } from "react-router-dom";
import { secureCallable } from "../services/security/secureCallable";


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
      await secureCallable("register", {
        email
      }, "register_email");

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
  <div style={{ maxWidth: 400, margin: "100px auto" }}>
    <Toast ref={toast} />
    <h2>Registrazione nuovo utente</h2>

    {!submitted ? (
      <div className="p-fluid">
        <InputText
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="mb-3"
        />

        <Button
          label={loading ? "Invio in corso..." : "Invia la richiesta"}
          onClick={handleRegister}
          disabled={loading || !email}
        />
      <Button
        label="Torna alla login"
        className="p-button-text mt-2"
        onClick={() => navigate("/login")}
        disabled={loading}
      />
      </div>
    ) : (
      <div
        style={{
          marginTop: 24,
          background: "#f6ffed",
          border: "1px solid #b7eb8f",
          borderRadius: 6,
          padding: 16,
          color: "#135200",
        }}
      >
        <strong>Controlla la tua email</strong> per completare la
        registrazione seguendo le istruzioni ricevute.
        <br />
        Se non ricevi la mail entro pochi minuti, controlla anche la cartella spam.
      </div>
    )}
  </div>
);
}
