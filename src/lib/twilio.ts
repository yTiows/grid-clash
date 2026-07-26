import "server-only"

import twilio from "twilio"

export const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID ?? "",
  process.env.TWILIO_AUTH_TOKEN ?? ""
)

export const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? ""
