import {initializeApp} from "firebase-admin/app";

initializeApp();

export {createDeviceRequest} from "./device/createDeviceRequest";
export {changeStatus} from "./device/changeStatus";
export {assignVolunteer} from "./device/assignVolunteer";
export { register, checkRegistration, completeRegistration, registerWithIntegratedAuth, doLogin } from "./auth/register";
export { setPassword } from "./auth/setPassword";
export { activateVolunteers, deactivateVolunteers } from "./volunteer/volunteerState";
export { updateVolunteerProfile } from "./volunteer/updateVolunteerProfile";
export { addPrinter } from "./volunteer/addPrinter";
export { inviteVolunteer } from "./volunteer/invite";

console.log("REGISTER BUILD SUCCESSFUL - " + new Date().toISOString());
