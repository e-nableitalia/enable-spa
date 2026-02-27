export interface VolunteerPrivateProfile {
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  telegramUsername: string;
  availability: string;
  continuityType: string;
  desiredInvolvementLevel: string;
  consentPrivacy: boolean;
}

export interface VolunteerSkills {
  aboutMe: string;
  mainInterest: string[];
  enableInterestAreas: string[];
  contributionPreferences: string;
  desiredSkills: string;
}

export interface VolunteerPublicProfile {
  showInVolunteerList: boolean;
  publicEmail: string;
  bio: string;
  facebook: string;
  instagram: string;
  linkedin: string;
}