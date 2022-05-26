// The code snippet below is functional, but is made ugly on purpose
// Please refactor it to a state you'd be satisfied with and send back the refactored code

// Bonus challenge: there is a simple change that will improve database writes drastically
// Can you spot it?
const packages = require({startCronJob:'nugttah-backend/helpers/start.cron.job', Helpers:'nugttah-backend/helpers', Invoice:'nugttah-backend/modules/invoices', DirectOrder:'nugttah-backend/modules/direct.orders', Part:'nugttah-backend/modules/parts', DirectOrderPart:'nugttah-backend/modules/direct.order.parts'})
const {startCronJob, Helpers, Invoice, DirectOrder, Part, DirectOrderPart} = packages


const createInvoice = async () => {
  try {
    const dps = await DirectOrderPart.Model.find({ createdAt: { $gt: new Date('2021-04-01') }, fulfillmentCompletedAt: { $exists: true }, invoiceId: { $exists: false } }).select('_id directOrderId partClass priceBeforeDiscount') ;
    const all_ps = await Part.Model.find({ directOrderId: { $exists: true }, createdAt: { $gt: new Date('2021-04-01') }, partClass: 'requestPart', pricedAt: { $exists: true }, invoiceId: { $exists: false } }).select('_id directOrderId partClass premiumPriceBeforeDiscount');

    const allParts = all_ps.concat(dps);

    const directOrderPartsGroups = Helpers.groupBy(allParts, 'directOrderId');

    const invcs = [];

    for (const allDirectOrderParts of directOrderPartsGroups) {
      const data = {
                    directOrder : await DirectOrder.Model.findOne({ _id: allDirectOrderParts[0].directOrderId }).select('partsIds requestPartsIds discountAmount deliveryFees walletPaymentAmount'),
                     invoces: await Invoice.Model.find({ directOrderId: allDirectOrderParts[0].directOrderId }).select('walletPaymentAmount discountAmount deliveryFees'),
                     directOrderParts: allDirectOrderParts.filter(directOrderPart => directOrderPart.partClass === 'StockPart' || directOrderPart.partClass === 'QuotaPart'),
                     requestParts : allDirectOrderParts.filter(part => part.partClass === 'requestPart'),
                    }
      
      const {directOrder, invoces, directOrderParts, requestParts} = data

      const { deliveryFees } = directOrder;

      const rpsprice = requestParts.reduce((sum, part) => sum + part.premiumPriceBeforeDiscount, 0).map(part => part._id);

      const dpsprice = directOrderParts.reduce((sum, part) => sum + part.priceBeforeDiscount, 0).map(part => part._id);
            
      const TotalPrice = Helpers.Numbers.toFixedNumber(rpsprice + dpsprice);

      let { walletPaymentAmount, discountAmount } = directOrder;
      let totalAmount = TotalPrice;

      if (directOrder.deliveryFees && invoces.length === 0) totalAmount += directOrder.deliveryFees;
      
      if (walletPaymentAmount) {
        invoces.forEach(invo => {
          walletPaymentAmount = Math.min(0, walletPaymentAmount - invo.walletPaymentAmount);
        });
        walletPaymentAmount = Math.min(walletPaymentAmount, totalAmount);
        totalAmount -= walletPaymentAmount;
      }
      if (discountAmount) {
        invoces.forEach(nvc => {
          discountAmount = Math.min(0, discountAmount - nvc.discountAmount);
        });
        discountAmount = Math.min(discountAmount, totalAmount);
        totalAmount -= discountAmount;
      }

      if (totalAmount < 0) throw Error(`Could not create invoice for directOrder: ${directOrder._id} with totalAmount: ${totalAmount}. `);
      
      const invoice = await Invoice.Model.create({ directOrderId: directOrder._id, directOrderPartsIds: dps_id, requestPartsIds: rps_id, totalPartsAmount: TotalPrice, totalAmount, deliveryFees, walletPaymentAmount, discountAmount });

      await DirectOrder.Model.updateOne({ _id: directOrder._id }, { $addToSet: { invoicesIds: invoice._id } });
      
      for (const dp_id of dps_id) await DirectOrderPart.Model.updateOne({ _id: dp_id }, { invoiceId: invoice._id });
      

      // wait for updates before pushing to invoices array
      await rps_id.map((rp_id) => {
        return new Promise((resolve, reject) => {
          Part.Model.updateOne({ _id: rp_id }, { invoiceId: invoice._id }).then(function (result) {
            return resolve();
          })
            .catch(() => {
              reject();
            });
        });
      });

      invcs.push(invoice._id);
    }
    return { case: 1, message: 'invoices created successfully.', invoicesIds: invcs };
  } catch (err) {
    Helpers.reportError(err);
  }
}

startCronJob('*/1 * * * *', createInvoice, true); // at 00:00 every day

module.exports = createInvoice;