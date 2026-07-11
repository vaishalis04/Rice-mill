import axios from "axios";

const API_URL = "http://localhost:3000/api/auth/register";

async function registerUsers() {
  for (let roleId = 2; roleId <= 11; roleId++) {
    const payload = {
      username: `role${roleId}`,
      email: `${roleId}@gmail.com`,
      password: `role${roleId}@${roleId}`,
      role_id: roleId,
    };

    try {
      const response = await axios.post(API_URL, payload);

      console.log(`✅ Role ${roleId} created`);
      console.log(response.data);
    } catch (error) {
      console.log(`❌ Failed for Role ${roleId}`);

      if (error.response) {
        console.log(error.response.data);
      } else {
        console.log(error.message);
      }
    }

    console.log("--------------------------------");
  }
}

registerUsers();