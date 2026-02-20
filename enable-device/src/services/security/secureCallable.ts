import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import { getRecaptchaToken } from "./recaptcha";

export const secureCallable = async (
  functionName: string,
  data: any,
  action: string
) => {

  const token = await getRecaptchaToken(action);

  console.log(`reCAPTCHA token for action "${action}":`, token, data);

  const callable = httpsCallable(functions, functionName);

  return callable({
    ...data,
    recaptchaToken: token,
  });
};
