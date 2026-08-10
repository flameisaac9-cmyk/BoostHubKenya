const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Minimum amount a customer can pay
const MIN_PAYMENT_AMOUNT = 10;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // -----------------------------
    // CORS PREFLIGHT
    // -----------------------------
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // -----------------------------
    // HEALTH CHECK
    // -----------------------------
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        success: true,
        message: "BoostHubKenya API is running",
      });
    }

    // -----------------------------
    // M-PESA STK PUSH
    // -----------------------------
    if (
      url.pathname === "/api/mpesa/stkpush" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const phone = String(body.phone || "").trim();

        const amount = Number(body.amount);

        const accountReference =
          String(
            body.accountReference || "BoostHubKenya"
          ).trim();

        const transactionDesc =
          String(
            body.transactionDesc || "BoostHubKenya Payment"
          ).trim();

        // -----------------------------
        // CHECK PHONE
        // -----------------------------
        if (!phone) {
          return json(
            {
              success: false,
              message: "Phone number is required",
            },
            400
          );
        }

        // -----------------------------
        // CHECK PAYMENT AMOUNT
        // Minimum = KES 10
        // -----------------------------
        if (
          !Number.isFinite(amount) ||
          !Number.isInteger(amount) ||
          amount < MIN_PAYMENT_AMOUNT
        ) {
          return json(
            {
              success: false,
              message:
                `Minimum payment amount is KES ${MIN_PAYMENT_AMOUNT}. Enter a whole number.`,
            },
            400
          );
        }

        const normalizedPhone =
          normalizeKenyanPhone(phone);

        // -----------------------------
        // CHECK KENYAN PHONE
        // -----------------------------
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

        // -----------------------------
        // GET SAFARICOM ACCESS TOKEN
        // -----------------------------
        const accessToken =
          await getMpesaToken(env);

        const timestamp = getTimestamp();

        const shortcode = env.MPESA_SHORTCODE;
        const passkey = env.MPESA_PASSKEY;

        if (!shortcode || !passkey) {
          return json(
            {
              success: false,
              message:
                "M-Pesa shortcode or passkey is not configured.",
            },
            500
          );
        }

        const password = btoa(
          `${shortcode}${passkey}${timestamp}`
        );

        // -----------------------------
        // M-PESA ENVIRONMENT
        // -----------------------------
        const baseUrl =
          env.MPESA_ENV === "production"
            ? "https://api.safaricom.co.ke"
            : "https://sandbox.safaricom.co.ke";

        const stkUrl =
          `${baseUrl}/mpesa/stkpush/v1/processrequest`;

        // -----------------------------
        // SEND STK PUSH
        // -----------------------------
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

            TransactionType:
              "CustomerPayBillOnline",

            // Customer-selected amount
            Amount: amount,

            PartyA: normalizedPhone,

            PartyB: Number(shortcode),

            PhoneNumber: normalizedPhone,

            CallBackURL:
              env.MPESA_CALLBACK_URL,

            AccountReference:
              accountReference.substring(0, 12),

            TransactionDesc:
              transactionDesc.substring(0, 13),
          }),
        });

        const data = await response.json();

        // -----------------------------
        // CHECK M-PESA RESPONSE
        // -----------------------------
        if (
          !response.ok ||
          data.ResponseCode !== "0"
        ) {
          return json(
            {
              success: false,

              message:
                data.errorMessage ||
                data.ResponseDescription ||
                "M-Pesa request failed",

              mpesa: data,
            },
            400
          );
        }

        // -----------------------------
        // SUCCESS
        // -----------------------------
        return json({
          success: true,

          message:
            "STK Push sent successfully",

          amount: amount,

          phone: normalizedPhone,

          checkoutRequestId:
            data.CheckoutRequestID,

          merchantRequestId:
            data.MerchantRequestID,

          responseCode:
            data.ResponseCode,

          responseDescription:
            data.ResponseDescription,
        });
      } catch (error) {
        console.error(
          "STK Push error:",
          error
        );

        return json(
          {
            success: false,

            message:
              "Unable to start M-Pesa payment",

            error:
              error?.message ||
              "Unknown error",
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
        const callback =
          await request.json();

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

        const resultCode =
          stk.ResultCode;

        const resultDesc =
          stk.ResultDesc;

        const checkoutRequestId =
          stk.CheckoutRequestID;

        let receipt = null;
        let amount = null;
        let phone = null;

        // -----------------------------
        // READ CALLBACK METADATA
        // -----------------------------
        if (
          Array.isArray(
            stk.CallbackMetadata?.Item
          )
        ) {
          for (
            const item of stk.CallbackMetadata.Item
          ) {
            if (
              item.Name ===
              "MpesaReceiptNumber"
            ) {
              receipt = item.Value;
            }

            if (item.Name === "Amount") {
              amount = item.Value;
            }

            if (
              item.Name === "PhoneNumber"
            ) {
              phone = item.Value;
            }
          }
        }

        // -----------------------------
        // PAYMENT SUCCESSFUL
        // -----------------------------
        if (resultCode === 0) {
          console.log(
            "PAYMENT SUCCESSFUL",
            {
              checkoutRequestId,
              receipt,
              amount,
              phone,
            }
          );

          // You can connect this to D1
          // later to automatically mark
          // an order as paid.
        } else {
          // -----------------------------
          // PAYMENT FAILED / CANCELLED
          // -----------------------------
          console.log(
            "PAYMENT FAILED",
            {
              checkoutRequestId,
              resultCode,
              resultDesc,
            }
          );
        }

        return json({
          ResultCode: 0,
          ResultDesc: "Accepted",
        });
      } catch (error) {
        console.error(
          "Callback error:",
          error
        );

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
        const body =
          await request.json();

        const checkoutRequestId =
          String(
            body.checkoutRequestId || ""
          ).trim();

        if (!checkoutRequestId) {
          return json(
            {
              success: false,
              message:
                "CheckoutRequestID is required",
            },
            400
          );
        }

        const accessToken =
          await getMpesaToken(env);

        const timestamp =
          getTimestamp();

        const shortcode =
          env.MPESA_SHORTCODE;

        const passkey =
          env.MPESA_PASSKEY;

        const password = btoa(
          `${shortcode}${passkey}${timestamp}`
        );

        const baseUrl =
          env.MPESA_ENV === "production"
            ? "https://api.safaricom.co.ke"
            : "https://sandbox.safaricom.co.ke";

        const queryUrl =
          `${baseUrl}/mpesa/stkpushquery/v1/query`;

        const response = await fetch(
          queryUrl,
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              BusinessShortCode:
                Number(shortcode),

              Password: password,

              Timestamp: timestamp,

              CheckoutRequestID:
                checkoutRequestId,
            }),
          }
        );

        const data =
          await response.json();

        return json({
          success: response.ok,
          mpesa: data,
        });
      } catch (error) {
        console.error(
          "STK query error:",
          error
        );

        return json(
          {
            success: false,
            message:
              error?.message ||
              "Unable to query payment",
          },
          500
        );
      }
    }

    // -----------------------------
    // API INFORMATION
    // -----------------------------
    if (
      url.pathname === "/api" &&
      request.method === "GET"
    ) {
      return json({
        name: "BoostHubKenya API",

        status: "online",

        minimumPayment:
          `KES ${MIN_PAYMENT_AMOUNT}`,

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

    return new Response(
      "BoostHubKenya API is running",
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  },
};


// ========================================
// GET M-PESA OAUTH TOKEN
// ========================================
async function getMpesaToken(env) {
  const consumerKey =
    env.MPESA_CONSUMER_KEY;

  const consumerSecret =
    env.MPESA_CONSUMER_SECRET;

  if (
    !consumerKey ||
    !consumerSecret
  ) {
    throw new Error(
      "M-Pesa consumer key or consumer secret is not configured."
    );
  }

  const credentials = btoa(
    `${consumerKey}:${consumerSecret}`
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
        Authorization:
          `Basic ${credentials}`,
      },
    }
  );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {
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
  let value =
    phone.replace(/[^\d+]/g, "");

  // +254712345678
  if (value.startsWith("+254")) {
    value = value.substring(1);
  }

  // 254712345678
  if (value.startsWith("254")) {
    if (value.length === 12) {
      return value;
    }
  }

  // 0712345678
  if (
    value.startsWith("0") &&
    value.length === 10
  ) {
    return (
      "254" +
      value.substring(1)
    );
  }

  // 712345678
  if (
    value.length === 9 &&
    value.startsWith("7")
  ) {
    return "254" + value;
  }

  return null;
}


// ========================================
// TIMESTAMP
// ========================================
function getTimestamp() {
  // Safaricom Daraja timestamp uses
  // East Africa Time (UTC+3).

  const now = new Date();

  const kenyaTime =
    new Date(
      now.getTime() +
      3 * 60 * 60 * 1000
    );

  const year =
    kenyaTime.getUTCFullYear();

  const month =
    String(
      kenyaTime.getUTCMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      kenyaTime.getUTCDate()
    ).padStart(2, "0");

  const hours =
    String(
      kenyaTime.getUTCHours()
    ).padStart(2, "0");

  const minutes =
    String(
      kenyaTime.getUTCMinutes()
    ).padStart(2, "0");

  const seconds =
    String(
      kenyaTime.getUTCSeconds()
    ).padStart(2, "0");

  return (
    `${year}${month}${day}` +
    `${hours}${minutes}${seconds}`
  );
}


// ========================================
// JSON RESPONSE
// ========================================
function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "Content-Type":
          "application/json",

        ...corsHeaders,
      },
    }
  );
}
