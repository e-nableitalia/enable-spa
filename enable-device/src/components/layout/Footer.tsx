import React from "react";

const Footer: React.FC = () => (
  <footer style={{ marginTop: 40, padding: "16px 0", fontSize: "0.9em", color: "#888", textAlign: "center" }}>
    <div>
      Copyright © 2026 |{" "}
      <a href="https://e-nableitalia.it" target="_blank" rel="noopener noreferrer" style={{ color: "#888", textDecoration: "underline" }}>
        e-Nable Italia
      </a>{" "}
      /{" "}
      <a href="https://energyfamilyproject.org" target="_blank" rel="noopener noreferrer" style={{ color: "#888", textDecoration: "underline" }}>
        Energy Family Project APS
      </a>{" "}
      | CF 96433270582
    </div>
    <div>
      <a href="https://e-nableitalia.it/it_it/privacy-policy-2/" target="_blank" rel="noopener noreferrer" style={{ color: "#888", textDecoration: "underline" }}>
        Privacy Policy
      </a>{" "}
      | Email: <a href="mailto:info@e-nableitalia.it" style={{ color: "#888", textDecoration: "underline" }}>info@e-nableitalia.it</a>
    </div>
  </footer>
);

export default Footer;
