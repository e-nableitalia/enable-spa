import { useRef, useState } from "react";
import logo from "../assets/logo.png";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
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

  return (
    <div style={{ maxWidth: 400, margin: "100px auto" }}>
      <Toast ref={toast} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, justifyContent: "center" }}>
        <img src={logo} alt="Logo" style={{ width: 64, height: 64 }} />
        <h2>e-Nable Italia Login</h2>
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
      </div>
    </div>
  );
}
