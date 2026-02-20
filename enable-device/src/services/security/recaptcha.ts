declare global {
  interface Window {
    grecaptcha: any;
  }
}

const SITE_KEY = '6Lfr8G4sAAAAAO81frUGstTO2ED9cJc9t3XO3gm0';

export const getRecaptchaToken = async (
  action: string
): Promise<string> => {

  if (!window.grecaptcha?.enterprise) {
    throw new Error("reCAPTCHA not loaded");
  }

  return new Promise((resolve, reject) => {
    window.grecaptcha.enterprise.ready(() => {
      window.grecaptcha.enterprise
        .execute(SITE_KEY, { action })
        .then((token: string) => resolve(token))
        .catch((err: any) => reject(err));
    });
  });

  // const token = await window.grecaptcha.enterprise.execute(
  //   SITE_KEY,
  //   { action }
  // );
  //return token;
};
