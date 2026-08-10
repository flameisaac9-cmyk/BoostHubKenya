const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // -----------------------------
    // HEALTH CHECK
    // -----------------------------
    if (url.pathname === "/api/health") {
      return json({
        success: true,
        message: "BoostHubKenya API is running",
      });
    }

    // -----------------------------
    // M-PESA STK PUSH
    // -----------------------------
    if (url.pathname === "/api/mpesa/stkpush" && request.method === "POST") {
      try {
        const body = await request.json();

        const phone = String(body.phone || "").trim();
        const amount = Number(body.amount);
        const accountReference =
          String(body.accountReference || "BoostHubKenya").trim();
        const transactionDesc =
          String(body.transactionDesc || "BoostHubKenya Payment").trim();

        if (!phone) {
          return json(
            { success: false, message: "Phone number is required" },
            400
          );
        }

        if (!Number.isFinite(amount) || amount < 1) {
          return json(
            { success: false, message: "Invalid payment amount" },
            400
          );
        }

        const normalizedPhone = normalizeKenyanPhone(phone);

        if (!normalizedPhone) {
          return json(
            {
              success: false,
              message:
                "Enter a valid Kenyan M-Pesa number, e.g. 0712345678",
            },
            400
          );
        }

        // Get Safaricom access token
        const accessToken = await getMpesaToken(env);

        const timestamp = getTimestamp();

        const shortcode = env.MPESA_SHORTCODE;
        const passkey = env.MPESA_PASSKEY;

        const password = btoa(
          `${shortcode}${passkey}${timestamp}`
        );

        const baseUrl =
          env.MPESA_ENV === "production"
            ? "https://api.safaricom.co.ke"
            : "https://sandbox.safaricom.co.ke";

        const stkUrl =
          `${baseUrl}/mpesa/stkpush/v1/processrequest`;

        const response = await fetch(stkUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            BusinessShortCode: Number(shortcode),
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: Math.round(amount),
            PartyA: normalizedPhone,
            PartyB: Number(shortcode),
            PhoneNumber: normalizedPhone,
            CallBackURL: env.MPESA_CALLBACK_URL,
            AccountReference: accountReference.substring(0, 12),
            TransactionDesc: transactionDesc.substring(0, 13),
          }),
        });

        const data = await response.json();

        if (!response.ok || data.ResponseCode !== "0") {
          return json(
            {
              success: false,
              message: data.errorMessage || data.ResponseDescription || "M-Pesa request failed",
              mpesa: data,
            },
            400
          );
        }

        return json({
          success: true,
          message: "STK Push sent successfully",
          checkoutRequestId: data.CheckoutRequestID,
          merchantRequestId: data.MerchantRequestID,
          responseCode: data.ResponseCode,
          responseDescription: data.ResponseDescription,
        });
      } catch (error) {
        return json(
          {
            success: false,
            message: "Unable to start M-Pesa payment",
            error: error.message,
          },
          500
        );
      }
    }

    // -----------------------------
    // M-PESA CALLBACK
    // -----------------------------
    if (
      url.pathname === "/api/mpesa/callback" &&
      request.method === "POST"
    ) {
      try {
        const callback = await request.json();

        console.log(
          "M-PESA CALLBACK:",
          JSON.stringify(callback)
        );

        const stk =
          callback?.Body?.stkCallback;

        if (!stk) {
          return json({
            ResultCode: 0,
            ResultDesc: "Accepted",
          });
        }

        const resultCode = stk.ResultCode;
        const resultDesc = stk.ResultDesc;
        const checkoutRequestId = stk.CheckoutRequestID;

        let receipt = null;
        let amount = null;
        let phone = null;

        if (Array.isArray(stk.CallbackMetadata?.Item)) {
          for (const item of stk.CallbackMetadata.Item) {
            if (item.Name === "MpesaReceiptNumber") {
              receipt = item.Value;
            }

            if (item.Name === "Amount") {
              amount = item.Value;
            }

            if (item.Name === "PhoneNumber") {
              phone = item.Value;
            }
          }
        }

        // Payment was successful
        if (resultCode === 0) {
          console.log("PAYMENT SUCCESSFUL", {
            checkoutRequestId,
            receipt,
            amount,
            phone,
          });

          // You can later connect this to D1/KV
          // to automatically mark an order as paid.
        } else {
          console.log("PAYMENT FAILED", {
            checkoutRequestId,
            resultCode,
            resultDesc,
          });
        }

        return json({
          ResultCode: 0,
          ResultDesc: "Accepted",
        });
      } catch (error) {
        console.error("Callback error:", error);

        return json({
          ResultCode: 0,
          ResultDesc: "Accepted",
        });
      }
    }

    // -----------------------------
    // M-PESA STK QUERY
    // -----------------------------
    if (
      url.pathname === "/api/mpesa/status" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const checkoutRequestId =
          String(body.checkoutRequestId || "").trim();

        if (!checkoutRequestId) {
          return json(
            {
              success: false,
              message: "CheckoutRequestID is required",
            },
            400
          );
        }

        const accessToken = await getMpesaToken(env);

        const timestamp = getTimestamp();

        const shortcode = env.MPESA_SHORTCODE;
        const passkey = env.MPESA_PASSKEY;

        const password = btoa(
          `${shortcode}${passkey}${timestamp}`
        );

        const baseUrl =
          env.MPESA_ENV === "production"
            ? "https://api.safaricom.co.ke"
            : "https://sandbox.safaricom.co.ke";

        const queryUrl =
          `${baseUrl}/mpesa/stkpushquery/v1/query`;

        const response = await fetch(queryUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            BusinessShortCode: Number(shortcode),
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestId,
          }),
        });

        const data = await response.json();

        return json({
          success: response.ok,
          mpesa: data,
        });
      } catch (error) {
        return json(
          {
            success: false,
            message: error.message,
          },
          500
        );
      }
    }

    // -----------------------------
    // API INFORMATION
    // -----------------------------
    if (url.pathname === "/api") {
      return json({
        name: "BoostHubKenya API",
        status: "online",
        endpoints: [
          "POST /api/mpesa/stkpush",
          "POST /api/mpesa/status",
          "POST /api/mpesa/callback",
          "GET /api/health",
        ],
      });
    }

    // -----------------------------
    // SERVE WEBSITE
    // -----------------------------
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("BoostHubKenya API is running", {
      status: 200,
      headers: corsHeaders,
    });
  },
};


// ========================================
// GET M-PESA OAUTH TOKEN
// ========================================
async function getMpesaToken(env) {
  const credentials = btoa(
    `${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`
  );

  const baseUrl =
    env.MPESA_ENV === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  const response = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description ||
      data.errorMessage ||
      "Could not obtain M-Pesa access token"
    );
  }

  return data.access_token;
}


// ========================================
// NORMALIZE KENYAN PHONE NUMBER
// ========================================
function normalizeKenyanPhone(phone) {
  let value = phone.replace(/[^\d+]/g, "");

  if (value.startsWith("+254")) {
    value = value.substring(1);
  }

  if (value.startsWith("254")) {
    if (value.length === 12) {
      return value;
    }
  }

  if (value.startsWith("0") && value.length === 10) {
    return "254" + value.substring(1);
  }

  if (value.length === 9 && value.startsWith("7")) {
    return "254" + value;
  }

  return null;
}


// ========================================
// TIMESTAMP
// ========================================
function getTimestamp() {
  const now = new Date();

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours() + 3).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}


// ========================================
// JSON RESPONSE
// ========================================
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
          }
