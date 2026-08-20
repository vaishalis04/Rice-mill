const createError = require("http-errors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { User, Role, PlantMaster } = require("../models");
const { generateCode } = require("../helpers/helperFunction");

const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "access_secret";

const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || "refresh_secret";

module.exports = {
  // Register
  register: async (req, res, next) => {
    try {
      const {
        username,
        email,
        phone,
        password,
        role_id,
        plant_id,
      } = req.body;

      const exists = await User.findOne({
        where: {
          email,
          is_deleted: false,
        },
      });

      if (exists) {
        throw createError.Conflict("Email already exists");
      }

      const role = await Role.findByPk(role_id);

      if (!role) {
        throw createError.BadRequest("Invalid Role");
      }

      if (plant_id) {
        const plant = await PlantMaster.findByPk(plant_id);

        if (!plant) {
          throw createError.BadRequest("Invalid Plant");
        }
      }

      const password_hash = await bcrypt.hash(password, 10);

      const user = await User.create({
        username,
        email,
        phone,
        password_hash,
        role_id,
        employee_code: await generateCode(User, "employee_code", "EMP"),
        plant_id,
      });

      res.status(201).json({
        success: true,
        msg: "User Registered Successfully",
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
        },
      });
    } catch (err) {
      console.log(err);
  console.log(err.errors);
      next(err);
    }
  },

  // Login
  login: async (req, res, next) => {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({
        where: {
          email,
          is_deleted: false,
        },
      });

      if (!user) {
        throw createError.Unauthorized("Invalid Email or Password");
      }

      const match = await bcrypt.compare(
        password,
        user.password_hash
      );

      if (!match) {
        throw createError.Unauthorized("Invalid Email or Password");
      }

      if (!user.is_active) {
        throw createError.Forbidden("Account Disabled");
      }

      const accessToken = jwt.sign(
        {
          id: user.id,
          role_id: user.role_id,
          plant_id: user.plant_id,
        },
        ACCESS_TOKEN_SECRET,
        {
          expiresIn: "15m",
        }
      );

      const refreshToken = jwt.sign(
        {
          id: user.id,
        },
        REFRESH_TOKEN_SECRET,
        {
          expiresIn: "7d",
        }
      );

      user.refresh_token = refreshToken;
      await user.save();

      res.json({
        success: true,
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role_id: user.role_id,
          plant_id: user.plant_id,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // Refresh Token
  refresh: async (req, res, next) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw createError.Unauthorized();
      }

      const user = await User.findOne({
        where: {
          refresh_token: refreshToken,
        },
      });

      if (!user) {
        throw createError.Forbidden("Invalid Refresh Token");
      }

      jwt.verify(
        refreshToken,
        REFRESH_TOKEN_SECRET,
        (err, decoded) => {
          if (err) {
            return next(createError.Forbidden("Expired Refresh Token"));
          }

          const accessToken = jwt.sign(
            {
              id: user.id,
              role_id: user.role_id,
              plant_id: user.plant_id,
            },
            ACCESS_TOKEN_SECRET,
            {
              expiresIn: "15m",
            }
          );

          res.json({
            success: true,
            accessToken,
          });
        }
      );
    } catch (err) {
      next(err);
    }
  },

  // Logout
  logout: async (req, res, next) => {
    try {
      // req.body can be undefined here — the frontend's logout call sends no
      // body at all, so express.json() never even attempts to parse it.
      const { refreshToken } = req.body || {};

      if (!refreshToken) {
        return res.json({
          success: true,
          msg: "Logged Out",
        });
      }

      const user = await User.findOne({
        where: {
          refresh_token: refreshToken,
        },
      });

      if (user) {
        user.refresh_token = null;
        await user.save();
      }

      res.json({
        success: true,
        msg: "Logout Successful",
      });
    } catch (err) {
      next(err);
    }
  },
};