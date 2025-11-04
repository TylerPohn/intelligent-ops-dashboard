// example hanadler
export const handler = async (event) => {
  console.log("Incoming event:", event);
  return { statusCode: 200, body: "OK" };
};