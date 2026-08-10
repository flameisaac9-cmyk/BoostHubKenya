// A. Payment Webhook Handler (Stripe/M-Pesa)
export async function handleWebhook(request) {
  const payload = await request.json();
  
  // Verify payment signature
  if (payload.status === 'paid') {
    await fulfillOrder(payload.orderId);
  }
}

// B. Service Delivery Function (The "Delivery Engine")
async function fulfillOrder(orderId) {
  const order = await DB.get(`order:${orderId}`);
  
  // Connect to SMM Panel API (most "growth" services use these)
  const smmResponse = await fetch('https://api.smm-panel.com/v2/order', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_PANEL_API_KEY',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      service: order.serviceType, // e.g., 'instagram_followers'
      link: order.socialUrl,
      quantity: order.amount
    })
  });
  
  // Update order status & notify user
  await DB.put(`order:${orderId}`, JSON.stringify({
    ...order,
    status: 'processing',
    panelId: smmResponse.data.order
  }));
}
