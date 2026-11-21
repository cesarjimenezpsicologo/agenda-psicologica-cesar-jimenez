// Default public site content. Used until the administrator saves their own values,
// and as a fallback for any field that has never been set.
export const DEFAULT_PHOTO_URL = "images/cesar-jimenez-psicologo.jpg";
export const DEFAULT_QR_URL = "images/registro-superintendencia-951548.jpg";

// Initial administrator password, used only until the administrator sets a new one.
export const INITIAL_ADMIN_PASSWORD = "2026";

export const SITE_TIMEZONE = "America/Santiago";

export interface Service {
  id: string;
  title: string;
  subtitle: string;
  duration: number;
  price: number;
  icon: string;
  description: string;
}

export interface SiteConfig {
  name: string;
  title: string;
  rnpiNumber: string;
  supersaludQrData: string;
  location: string;
  bio: string;
  tags: string[];
  whatsapp: string;
  instagram: string;
  tiktok: string;
  linkedin: string;
  email: string;
  bankHolder: string;
  bankRut: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankEmail: string;
  photoData: string;
  workingDays: number[];
  timeSlots: string[];
  scheduleLabel: string;
  services: Service[];
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  name: "César Jiménez",
  title: "Psicólogo",
  rnpiNumber: "951548",
  supersaludQrData: DEFAULT_QR_URL,
  location: "Iquique, Región de Tarapacá, Chile • 100% Online",
  bio: "Soy César Jiménez, Psicólogo. Te acompaño en tus procesos personales, gestión del estrés y burnout, y fortalecimiento de tu perfil laboral en un espacio confidencial 100% online.",
  tags: ["Acompañamiento emocional", "Manejo del estrés y burnout", "Currículum y empleabilidad"],
  whatsapp: "56927276098",
  instagram: "ps.cesar.jimenez",
  tiktok: "cesar.jimenez.psicologo",
  linkedin: "https://www.linkedin.com/in/c%C3%A9sar-jim%C3%A9nez-parra-89a2a7340",
  email: "cesar.jimenez.psicologo@hotmail.com",
  bankHolder: "César Jiménez",
  bankRut: "17.459.244-6",
  bankName: "BCI/MACHBANK",
  bankAccountType: "Cuenta Vista",
  bankAccountNumber: "777017459244",
  bankEmail: "cesar.jimenez.parra@outlook.com",
  photoData: DEFAULT_PHOTO_URL,
  workingDays: [1, 2, 3, 4, 5, 6],
  timeSlots: ["18:00", "19:00", "20:00"],
  scheduleLabel: "Atención 100% Online • Lunes a Sábado de 18:00 a 20:00 hrs",
  services: [
    {
      id: "acompanamiento",
      title: "Acompañamiento Emocional",
      subtitle: "100% Online",
      duration: 50,
      price: 35000,
      icon: "ph-heart-half",
      description:
        "Espacio terapéutico confidencial para abordar ansiedad, estado de ánimo, autoestima y procesos personales.",
    },
    {
      id: "burnout",
      title: "Manejo del Estrés y Burnout",
      subtitle: "100% Online",
      duration: 50,
      price: 35000,
      icon: "ph-battery-charging-vertical",
      description:
        "Herramientas prácticas para regular la sobrecarga laboral o académica, establecer límites saludables y recuperar el equilibrio.",
    },
    {
      id: "empleabilidad",
      title: "Currículum y Empleabilidad",
      subtitle: "100% Online",
      duration: 50,
      price: 35000,
      icon: "ph-briefcase",
      description:
        "Asesoría personalizada en diseño y optimización de CV, perfil laboral, búsqueda de empleo y preparación de entrevistas.",
    },
    {
      id: "orientacion",
      title: "Orientación y Desarrollo Profesional",
      subtitle: "100% Online",
      duration: 50,
      price: 35000,
      icon: "ph-compass",
      description:
        "Acompañamiento en transición laboral, definición de metas profesionales y toma de decisiones.",
    },
  ],
};
