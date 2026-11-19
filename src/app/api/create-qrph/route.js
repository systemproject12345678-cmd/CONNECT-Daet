import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { amount, description } = await request.json();
    const centavos = Math.round(parseFloat(amount) * 100);

    const intentRes = await fetch("https://api.paymongo.com/v1/payment_intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64"),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: centavos,
            currency: "PHP",
            payment_method_allowed: ["qrph"],
            description: description || "Event Registration Fee",
          },
        },
      }),
    });

    const intentData = await intentRes.json();
    if (!intentRes.ok) throw new Error(intentData.errors?.[0]?.detail || "Failed to create payment intent");

    const paymentIntentId = intentData.data.id;
    const clientKey = intentData.data.attributes.client_key;

    const pmRes = await fetch("https://api.paymongo.com/v1/payment_methods", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64"),
      },
      body: JSON.stringify({
        data: {
          attributes: { type: "qrph" },
        },
      }),
    });

    const pmData = await pmRes.json();
    if (!pmRes.ok) throw new Error(pmData.errors?.[0]?.detail || "Failed to create payment method");

    const attachRes = await fetch(`https://api.paymongo.com/v1/payment_intents/${paymentIntentId}/attach`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64"),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            payment_method: pmData.data.id,
            client_key: clientKey,
          },
        },
      }),
    });

    const attachData = await attachRes.json();
    if (!attachRes.ok) throw new Error(attachData.errors?.[0]?.detail || "Failed to attach payment method");

    const qrImageUrl = attachData.data.attributes.next_action.code.image_url;

    return NextResponse.json({ success: true, qrImageUrl });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}