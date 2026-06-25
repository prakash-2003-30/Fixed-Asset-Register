import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  companyName: process.env.COMPANY_NAME || 'HIKEHEALTH GS PRIVATE LIMITED',
  reportTitle: process.env.REPORT_TITLE || 'Fixed Asset Register',
};
