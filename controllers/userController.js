const ErrorHandler = require("../utils/errorhandler");
const catchAsyncErrors = require("../middleware/catchAsyncError");
const User = require("../models/UserModel");
const sendToken = require("../utils/jwtToken");
const crypto = require("crypto");
const cloudinary = require("cloudinary");
const sendEmail = require("../utils/sendEmail.js");
const getDataUri = require("../utils/dataUri.js");
const Product = require("../models/productModel");
const fs = require("fs");

// Register a User
exports.registerUser = catchAsyncErrors(async (req, res, next) => {
  const { full_name, phoneNo, email, password, confirm_password } = req.body;

  if (!full_name || !phoneNo || !email || !password || !confirm_password)
    return next(new ErrorHandler("Please fill all details", 400));

  if (password != confirm_password)
    return next(
      new ErrorHandler("Password and Confirm Password Doesn't Match", 400)
    );

  let user = await User.findOne({ email });

  if (user) {
    return res
      .status(400)
      .json({ success: false, message: "User already exists" });
  }

  const otp = Math.floor(Math.random() * 1000000);

  user = await User.create({
    full_name,
    email,
    phoneNo,
    password,
    otp,
    otp_expiry: new Date(Date.now() + process.env.OTP_EXPIRE * 60 * 1000),
  });

  const emailMessage = `Dear ${user.full_name},

Thank you for registering for the Java Sport event. To ensure the security of your account and complete the registration process, please verify your account by entering the following One-Time Password (OTP):

OTP: ${otp}

This OTP is valid for a limited time, so we recommend verifying your account as soon as possible. If you did not initiate this registration or have any concerns, please contact our support team immediately.

Thank you for choosing Java Sports.

Best regards,
Java Sports`;

  await sendEmail(email, "Verify your account", emailMessage);

  sendToken(
    user,
    201,
    res,
    "OTP sent to your email, please verify your account"
  );
});

//verify
exports.verify = catchAsyncErrors(async (req, res, next) => {
  const otp = Number(req.body.otp);

  const user = await User.findById(req.user.id);

  if (user.otp !== otp || user.otp_expiry < Date.now()) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid OTP or has been Expired" });
  }

  user.verified = true;
  user.otp = null;
  user.otp_expiry = null;

  await user.save();

  sendToken(user, 200, res, "Account Verified");
});

//login user
exports.loginUser = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;

  // checking if user has given password and email both

  if (!email || !password) {
    return next(new ErrorHandler("Please Enter Email & Password", 400));
  }

  const user = await User.findOne({ email }).select("+password");

  if (!user) {
    return next(new ErrorHandler("Invalid email or password", 401));
  }

  const isPasswordMatched = await user.comparePassword(password);

  if (!isPasswordMatched) {
    return next(new ErrorHandler("Invalid email or password", 401));
  }

  sendToken(user, 200, res);
});

// Logout User
exports.logout = catchAsyncErrors(async (req, res, next) => {
  res.cookie("token", null, {
    expires: new Date(Date.now()),
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });

  res.status(200).json({
    success: true,
    message: "Logged Out",
  });
});

// Forgot Password
exports.forgotPassword = catchAsyncErrors(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new ErrorHandler("Please enter email", 404));
  }

  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  // Get ResetPassword Token
  const resetToken = user.getResetPasswordToken();

  await user.save({ validateBeforeSave: false });

  const resetPasswordUrl = `${req.protocol}://${req.get(
    "host"
  )}/api/v1/password/reset/${resetToken}`;

  const message = `Your password reset token is :- \n\n ${resetPasswordUrl} \n\nIf you have not requested this email then, please ignore it.`;

  try {
    await sendEmail(user.email, "Java Sports Reset Password", message);

    res.status(200).json({
      success: true,
      message: `Email sent to ${user.email} successfully`,
    });
  } catch (error) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save({ validateBeforeSave: false });

    return next(new ErrorHandler(error.message, 500));
  }
});

// Reset Password
exports.resetPassword = catchAsyncErrors(async (req, res, next) => {
  // creating token hash
  const resetPasswordToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(
      new ErrorHandler(
        "Reset Password Token is invalid or has been expired",
        400
      )
    );
  }

  if (!req.body.password || !req.body.confirmPassword) {
    return next(new ErrorHandler("Please Enter Password", 400));
  }

  if (req.body.password !== req.body.confirmPassword) {
    return next(new ErrorHandler("Password does not password", 400));
  }

  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;

  await user.save();

  res.status(200).json({
    success: true,
    message: "Password reset successfully ",
  });
});

// Get User Detail
exports.getUserDetails = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  res.status(200).json({
    success: true,
    user,
  });
});

// update User password
exports.updatePassword = catchAsyncErrors(async (req, res, next) => {
  if (!req.body.oldPassword) {
    return next(new ErrorHandler("please enter your OLd password", 400));
  }

  const user = await User.findById(req.user.id).select("+password");

  const isPasswordMatched = await user.comparePassword(req.body.oldPassword);

  if (!isPasswordMatched) {
    return next(new ErrorHandler("Old password is incorrect", 400));
  }

  if (req.body.newPassword !== req.body.confirmPassword) {
    return next(new ErrorHandler("password does not match", 400));
  }

  user.password = req.body.newPassword;

  await user.save();

  res.status(200).json({
    success: true,
    message: "Password updated successfully ",
  });
});

// //update user details
exports.updateUserDetails = catchAsyncErrors(async (req, res, next) => {
  const { full_name, email, phone } = req.body;

  const file = req.file; // Assuming you are using multer or similar middleware for file uploads

  const user = await User.findById(req.user._id);

  if (full_name) user.full_name = full_name;
  if (email) user.email = email;
  if (phone) user.phone = phone;

  if (!user.avatar) {
    user.avatar = {};
  }

  if (file) {
    const fileUri = getDataUri(file);
    const mycloud = await cloudinary.v2.uploader.upload(fileUri.content, {
      folder: "avatars",
      width: 150,
      crop: "scale",
    });

    // Destroy existing avatar if present
    if (user.avatar.public_id) {
      await cloudinary.v2.uploader.destroy(user.avatar.public_id);
    }

    user.avatar = {
      public_id: mycloud.public_id,
      url: mycloud.secure_url,
    };
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: "Profile is updated successfully ",
  });
});

// Get all users(admin)
exports.getAllUser = catchAsyncErrors(async (req, res, next) => {
  const userCount = await User.countDocuments({ role: "user" });
  const users = await User.find({ role: "user" }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    userCount,
    users,
  });
});

// Get single user (admin)
exports.getSingleUser = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(
      new ErrorHandler(`User does not exist with Id: ${req.params.id}`)
    );
  }

  res.status(200).json({
    success: true,
    user,
  });
});

// update User Role -- Admin
exports.updateUserRole = catchAsyncErrors(async (req, res, next) => {
  const newUserData = {
    role: req.body.role,
  };

  await User.findByIdAndUpdate(req.params.id, newUserData, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });

  res.status(200).json({
    success: true,
    message: "User has been updated",
  });
});

//Add Product to wishlist
exports.addWishlist = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  const product = await Product.findById(req.body.id);

  if (!product) {
    return next(new ErrorHandler(`Product Not Found`));
  }
  const itemExist = user.wishlist.find((item) => {
    if (item.product.toString() === product._id.toString()) return true;
  });

  if (itemExist)
    return next(new ErrorHandler("Already Added to Wishlist", 409));

  user.wishlist.push({
    product: product._id,
    poster: product.images[0].url,
  });

  await user.save();

  res.status(200).json({
    success: true,
    message: "Added to Wishlist",
  });
});

//remove Product from wishlist
exports.removeWishlist = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  const product = await Product.findById(req.query.id);

  if (!product) {
    return next(new ErrorHandler(`Product Not Found`));
  }

  const newFavourite = user.wishlist.filter((item) => {
    if (item.product.toString() !== product._id.toString()) return item;
  });

  user.wishlist = newFavourite;
  await user.save();

  res.status(200).json({
    success: true,
    message: "Removed Wishlist",
  });
});

//update address
exports.updateUserAddress = catchAsyncErrors(async (req, res, next) => {
  const { primaryaddress, secondaryaddress, thirdaddress } = req.body;

  const user = await User.findById(req.user._id);

  if (primaryaddress) user.primaryaddress = primaryaddress;
  if (secondaryaddress) user.secondaryaddress = secondaryaddress;
  if (thirdaddress) user.thirdaddress = thirdaddress;

  await user.save();

  res.status(200).json({
    success: true,
    message: "Address Updated Successfully",
  });
});
