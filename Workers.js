async function initiateMpesa(phoneNumber, amount, orderId) {
  const response = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${await getMPesaToken()}` },
    body: JSON.stringify({
      BusinessShortCode: '174379', // Test shortcode
      Password: generatePassword(),
      Timestamp: getTimestamp(),
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phoneNumber, // Customer phone
      PartyB: '174379',
      PhoneNumber: phoneNumber,
      CallBackURL: `https://your-worker.workers.dev/mpesa-callback`, // YOUR WORKER URL
      AccountReference: orderId,
      TransactionDesc: 'Social Media Boost'
    })
  });
}
