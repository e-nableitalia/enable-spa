import React from "react";

const linkStyle: React.CSSProperties = { color: "#6b7079", textDecoration: "underline" };

const Footer: React.FC = () => (
  <footer
    style={{
      marginTop: 48,
      padding: "20px 16px 28px",
      borderTop: "1px solid #e7e7ea",
      fontSize: "0.875em",
      lineHeight: 1.7,
      color: "#6b7079",
      textAlign: "center",
    }}
  >
    <div>
      Copyright © 2026 |{" "}
      <a href="https://e-nableitalia.it" target="_blank" rel="noopener noreferrer" style={linkStyle}>
        e-Nable Italia
      </a>{" "}
      /{" "}
      <a href="https://energyfamilyproject.org" target="_blank" rel="noopener noreferrer" style={linkStyle}>
        Energy Family Project APS
      </a>{" "}
      | CF 96433270582
    </div>
    <div>
      <a href="https://e-nableitalia.it/it_it/privacy-policy-2/" target="_blank" rel="noopener noreferrer" style={linkStyle}>
        Privacy Policy
      </a>{" "}
      | Email: <a href="mailto:info@e-nableitalia.it" style={linkStyle}>info@e-nableitalia.it</a>
    </div>
  </footer>
);

export default Footer;
