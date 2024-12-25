const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const ErrorHander = require("../utils/errorhandler");
const catchAsyncErrors = require("../middleware/catchAsyncError");
const User = require("../models/UserModel");
const { myCache } = require("../app");
const sendEmail = require("../utils/sendEmail.js");

// Create new Order
exports.newOrder = catchAsyncErrors(async (req, res, next) => {
  const {
    shippingInfo,
    orderItems,
    // paymentInfo,
    itemsPrice,
    // taxPrice,
    // shippingPrice,
    totalPrice,
    discount,
    razorpay_payment_id,
  } = req.body;

  if (
    !shippingInfo ||
    !orderItems ||
    !itemsPrice ||
    !totalPrice ||
    !discount ||
    !razorpay_payment_id
  )
    return next(new ErrorHander("please enter all details", 400));

  const order = await Order.create({
    shippingInfo,
    orderItems,
    itemsPrice,
    totalPrice,
    discount,
    razorpay_payment_id,
    paidAt: Date.now(),
    user: req.user._id,
  });

  order.orderItems.forEach(async (o) => {
    await updateStock(o.product, o.quantity);
  });

  // myCache.del("all-orders");

  // Send confirmation email to the user
  // Send confirmation email to the user
  const userEmail = req.user.email;
  const userOrderItems = order.orderItems
    .map(
      (item) =>
        `Name: ${item.name}\nPrice: ${item.price}\nQuantity: ${item.quantity}\n`
    )
    .join("\n");

  // await sendEmail(
  //   userEmail,
  //   "Order Confirmation",
  //   `Dear ${req.user.full_name},\n\nThank you for placing an order with us. Your order has been successfully received.\n\nOrder ID: ${order._id}\nTotal Amount: ${totalPrice}\n\nOrder Items:\n${userOrderItems}\n\nWe will notify you once your order is shipped. If you have any questions, feel free to contact us.\n\nBest Regards,\nJava Sports`
  // );

  // Notify admin about the new order
  const adminEmail = "java@gmail.com"; // Replace with actual admin email
  const adminOrderItems = order.orderItems
    .map(
      (item) =>
        `Name: ${item.name}\nPrice: ${item.price}\nQuantity: ${item.quantity}\n`
    )
    .join("\n");

  // await sendEmail(
  //   adminEmail,
  //   "New Order Notification",
  //   `Dear Admin,\n\nA new order has been placed.\n\nOrder ID: ${order._id}\nTotal Amount: ${totalPrice}\n\nOrder Items:\n${adminOrderItems}\n\nPlease log in to the admin panel to process the order.\n\nBest Regards,\nJava Sports`
  // );

  // Respond to the client
  res.status(201).json({
    success: true,
    message:
      "We have received your order. You will receive a confirmation email shortly.",
  });
});

// get Single Order
exports.getSingleOrder = catchAsyncErrors(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  const id = order.user;

  const user = await User.findById(id);

  if (!order) {
    return next(new ErrorHander("Order not found with this Id", 404));
  }

  res.status(200).json({
    success: true,
    order,
    userdetails: {
      name: `${user.full_name}`,
      email: `${user.email}`,
    },
  });
});

// get logged in user  Orders
exports.myOrders = catchAsyncErrors(async (req, res, next) => {
  const orders = await Order.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

  res.status(200).json({
    success: true,
    orders,
  });
});

// get all Orders -- Admin
exports.getAllOrders = catchAsyncErrors(async (req, res, next) => {
  const ordersCount = await Order.countDocuments();

  let orders;
 
   orders = await Order.find().sort({ createdAt: -1 });

  // if (myCache.has("all-orders")) {
  //   orders = JSON.parse(myCache.get("all-orders"));
  // } else {
  //   orders = await Order.find().sort({ createdAt: -1 });
  //   myCache.set("all-orders", JSON.stringify(orders));
  // }
  res.status(200).json({
    success: true,
    ordersCount,
    orders,
  });
});

// update Order Status -- Admin
exports.updateOrder = catchAsyncErrors(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorHander("Order not found with this Id", 404));
  }

  if (order.orderStatus === "Delivered") {
    return next(new ErrorHander("You have already delivered this order", 400));
  }

  order.orderStatus = req.body.status;

  if (req.body.status === "Delivered") {
    order.deliveredAt = Date.now();
  }

  await order.save({ validateBeforeSave: false });

  // myCache.del("all-orders");

  res.status(200).json({
    success: true,
    message: "order updated",
  });
});

async function updateStock(id, quantity) {
  const product = await Product.findById(id);

  product.stock -= quantity;

  await product.save({ validateBeforeSave: false });
}

// delete Order -- Admin
exports.deleteOrder = catchAsyncErrors(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorHander("Order not found with this Id", 404));
  }

  await order.remove();

  // myCache.del("all-orders");
  res.status(200).json({
    success: true,
    message: "Order Deleted",
  });
});

exports.cancelOrder = catchAsyncErrors(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorHander("Order not found with this Id", 404));
  }

  if (order.orderStatus === "cancelled") {
    return next(new ErrorHander("This product is already cancelled", 404));
  }

  // Save the original order status for reference
  const originalStatus = order.orderStatus;

  // Set the order status to "cancelled"
  order.orderStatus = "cancelled";
  await order.save({ validateBeforeSave: false });

  // Send cancellation confirmation email to the user
  const userEmail = req.user.email;
  const userCancelledItems = order.orderItems
    .map(
      (item) =>
        `Name: ${item.name}\nPrice: ${item.price}\nQuantity: ${item.quantity}\n`
    )
    .join("\n");

  await sendEmail(
    userEmail,
    "Order Cancellation Confirmation",
    `Dear ${req.user.full_name},\n\nYour order (ID: ${order._id}) has been successfully cancelled.\n\nCancelled Items:\n${userCancelledItems}\n\nIf you have any further questions or concerns, please feel free to contact us.\n\nBest Regards,\nJava Sports`
  );

  // Notify admin about the order cancellation
  const adminEmail = "java@gmail.com"; // Replace with actual admin email
  const adminCancelledItems = order.orderItems
    .map(
      (item) =>
        `Name: ${item.name}\nPrice: ${item.price}\nQuantity: ${item.quantity}\n`
    )
    .join("\n");

  await sendEmail(
    adminEmail,
    "Order Cancellation Notification",
    `Dear Admin,\n\nOrder (ID: ${order._id}) has been cancelled.\n\nCancelled Items:\n${adminCancelledItems}\n\nOriginal Status: ${originalStatus}\n\nPlease review and update the order status in the admin panel.\n\nBest Regards,\nJava Sports`
  );

  // Respond to the client
  res.status(200).json({
    success: true,
    message:
      "Your order is cancelled. You will receive a confirmation email shortly.",
  });
});
