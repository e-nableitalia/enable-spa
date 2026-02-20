import { useRef, useState } from "react";
import logo from "../assets/logo.png";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Toast } from "primereact/toast";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const toast = useRef<Toast>(null);

  const handleLogin = async () => {
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const uid = credential.user.uid;

      const userDoc = await getDoc(doc(db, "users", uid));

      if (!userDoc.exists()) {
        navigate("/login");
        return;
      }

      const role = userDoc.data().role;

      if (role === "admin") {
        navigate("/admin");
      } else if (role === "volunteer") {
        navigate("/volunteer");
      } else {
        navigate("/login");
      }
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
    <div style={{ maxWidth: 400, margin: "100px auto" }}>
      <Toast ref={toast} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 16, justifyContent: "center" }}>
        <img src={logo} alt="Logo" style={{ width: 64, height: 64 }} />
          <h2>e-Nable Italia</h2>
          <h3 style={{ color: "#888", textAlign: "center" }}>Portale di Accesso</h3>
        </div>
      <div className="p-fluid">
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
      <div className="login-info-message" style={{ marginTop: 24, background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 6, padding: 16, color: "#614700" }}>
        <strong>Attenzione:</strong><br />
        Puoi accedere con <b>le tue credenziali</b> oppure con <b>Google</b>.<br />
        <span style={{ fontStyle: "italic" }}>
          Se non sei registrato, puoi <b>registrarti automaticamente</b> cliccando su <b>"Continua con Google"</b>
          oppure <b>registrarti manualmente</b> tramite il <b style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/register")}>link di registrazione nuovo utente</b>.
        </span>
      </div>    
    </div>
  );
}
