import type { FC, PropsWithChildren } from "react";
import { createContext, useEffect, useState } from "react";
import type { SubmitHandler } from "react-hook-form";
import { useForm } from "react-hook-form";
import { supabaseClient } from "~/components/InternalIframeDemo";
import { ethers, Wallet, Wallet as WalletType } from "ethers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IoKey } from "react-icons/io5";
import { FaTwitter, FaDiscord } from "react-icons/fa";
import { CiMail } from "react-icons/ci";
import {
  arrayBufferToBase64,
  convertStringToCryptoKey,
  decryptData,
  decryptPrivateKeyGetWallet,
  encryptData,
  isEmpty,
  uint8ArrayToBase64,
} from "~/lib/cryptoLib";
import { AuthApiError, User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TextField, Typography } from "@mui/material";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

//TODO Remix has loaders, which can break up this code into smaller, easier to manage/test parts
type VerifyEmailPasswordFormProps = {
  email: string;
  password: string;
};
type VerifyOtpFormProps = {
  email: string;
  otp: string;
};
type DeviceKeyContextProps = {
  wallet?: WalletType;
  deviceKey?: string;
  pin: string;
};

type UserMetadata = {
  pin_encrypted_private_key?: string;
  device_encrypted_private_key?: string;
  iv?: Uint8Array;
};

export const DeviceKeyContext = createContext<DeviceKeyContextProps>({
  deviceKey: undefined,
  pin: "",
  wallet: undefined,
});

// Get a user, and decrypt their private key
export const getUserEmbeddedWallet = async (
  pin?: string,
  deviceKey?: string
): Promise<Wallet> => {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser(); //TODO should this be getSession()?
  if (!user || !user.user_metadata) {
    throw new Error("User does not appear to be signed in");
  }
  const { pin_encrypted_private_key, device_encrypted_private_key, iv } =
    user.user_metadata;

  console.log("logged in user.user_metadata:", user.user_metadata);
  //Basic validation
  if (!pin_encrypted_private_key && !device_encrypted_private_key) {
    throw new Error("user has no embedded wallet"); //TODO, carve exception when user logged in with web3 wallet
  } else if (!iv) {
    throw new Error("legacy user has no iv, delete user and recreate");
  }

  if (pin && pin_encrypted_private_key) {
    console.log(
      "pin set, decrypting pin encrypted private key",
      pin_encrypted_private_key
    );
    return await decryptPrivateKeyGetWallet(pin_encrypted_private_key, pin, iv);
  } else if (deviceKey && device_encrypted_private_key) {
    console.log(
      "device key set, decrypting device encrypted private key",
      deviceKey
    );
    return await decryptPrivateKeyGetWallet(
      device_encrypted_private_key,
      deviceKey,
      iv
    );
  }
  throw new Error(
    `user has not submitted a valid combination of pin and pin_encrypted_private_key or devicePrivateKey and device_encrypted_private_key, ${{
      pin: pin,
      deviceKey,
      pin_encrypted_private_key,
      device_encrypted_private_key,
    }}`
  );
};

const createNewEmbeddedWalletForUser = async (
  pin: string,
  deviceKey?: string
) => {
  const session = await supabaseClient.auth.getSession();
  if (!session) {
    throw new Error("No session found");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const newEmbeddedWallet = ethers.Wallet.createRandom();

  const updateUserData = {
    iv: uint8ArrayToBase64(iv),
    pin_encrypted_private_key: "",
    device_encrypted_private_key: "",
  };
  console.log("Creating new embedded wallet for user", session);

  const deviceWallet = ethers.Wallet.createRandom();
  localStorage.setItem("devicepublickey", deviceWallet!.address);
  localStorage.setItem("deviceprivatekey", deviceWallet!.privateKey);
  deviceKey = deviceWallet!.privateKey;
  console.log("🚀 ~ file: RequireUserLoggedIn.tsx:144 ~ deviceKey:", deviceKey);
  if (pin) {
    const pinCryptoKey = await convertStringToCryptoKey(pin);
    const pinEncryptedPrivateKey = await encryptData(
      newEmbeddedWallet.privateKey,
      pinCryptoKey,
      iv
    );
    updateUserData.pin_encrypted_private_key = arrayBufferToBase64(
      pinEncryptedPrivateKey
    );
  }
  if (deviceKey) {
    const deviceCryptoKey = await convertStringToCryptoKey(deviceKey);
    const deviceEncryptedPrivateKey = await encryptData(
      newEmbeddedWallet.privateKey,
      deviceCryptoKey,
      iv
    );
    updateUserData.device_encrypted_private_key = arrayBufferToBase64(
      deviceEncryptedPrivateKey
    );
  }

  console.log("Updating user with: ", updateUserData);
  await supabaseClient.auth.updateUser({
    data: updateUserData,
  });
  console.log("Finished updating user");
};

export const userHasEmbeddedWallet = ({
  pin_encrypted_private_key,
  device_encrypted_private_key,
}: {
  pin_encrypted_private_key?: Object;
  device_encrypted_private_key?: Object;
}): boolean => {
  return (
    (!!pin_encrypted_private_key && !isEmpty(pin_encrypted_private_key)) ||
    (!!device_encrypted_private_key && !isEmpty(device_encrypted_private_key))
  );
};

export const RequireUserLoggedIn: FC<PropsWithChildren> = ({ children }) => {
  const [devicePrivateKey, setDevicePrivateKey] = useState("");
  const [pin, setPin] = useState("testing");
  const [wallet, setWallet] = useState<WalletType | undefined>(undefined);
  const [additionalError, setAdditionalError] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const {
    register: emailPassRegister,
    handleSubmit: emailPassHandleSubmit,
    formState: { errors: emailPassErrors },
  } = useForm<VerifyEmailPasswordFormProps>();
  const {
    register: verifyOtpRegister,
    handleSubmit: verifyOtpHandleSubmit,
    formState: { errors: verifyOtpErrors },
  } = useForm<VerifyOtpFormProps>();

  const [initializedLogin, setInitializedLogin] = useState(false);

  const logUserIntoApp = async (userMetadata: UserMetadata, pin: string) => {
    try {
      //TODO currently only supports pin, not device key
      if (!userHasEmbeddedWallet(userMetadata)) {
        console.log("user doesn't have an embedded wallet, creating one now");
        await createNewEmbeddedWalletForUser(pin, undefined);
      }
      const localWallet = await getUserEmbeddedWallet(
        pin,
        devicePrivateKey || ""
      );
      console.log("localWallet", localWallet);
      window.localStorage.setItem("pin", pin);
      setWallet(localWallet);
      setLoggedIn(true);
    } catch (error: any) {
      console.log("error", error);
      setAdditionalError(error.message);
    }
  };

  const emailPassSubmit: SubmitHandler<VerifyEmailPasswordFormProps> = async (
    formData
  ) => {
    try {
      console.log("Signing in with email and pass", formData);
      let user: User;

      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error && !(error instanceof AuthApiError)) {
        setAdditionalError(error.message);
        return;
      }
      if (!data.user) {
        console.log("user not found, signing up");
        const { data: signupData, error: signupError } =
          await supabaseClient.auth.signUp({
            email: formData.email,
            password: formData.password,
          });
        if (signupError) {
          setAdditionalError(signupError.message);
          return;
        } else if (!signupData.user) {
          setAdditionalError("No user found after signup");
          return;
        }
        console.log("user signed up", signupData);
        user = signupData.user;
      } else {
        console.log("user with email", formData.email, "found");
        user = data.user;
      }

      await logUserIntoApp(user.user_metadata, pin);
    } catch (error: any) {
      console.log("error", error);
      setAdditionalError(error.message);
    }
  };
  //TODO Function is far too complex and encourages duplication, break into smaller parts
  const verifyOtpSubmit: SubmitHandler<VerifyOtpFormProps> = async (
    formData
  ) => {
    try {
      console.log("Signing in with", formData);

      // First "submit" sends OTP to user's email. Second "submit" verifies OTP and logs in user.
      if (!initializedLogin) {
        const { data, error } = await supabaseClient.auth.signInWithOtp({
          //This also signs up users if they have not yet created an account.
          email: formData.email,
          options: {
            shouldCreateUser: true,
          },
          //password:document.getElementById('login-password').value,  //we will use the password for encrypting like the pin before
        });
        console.log("start login data", data);
        console.log("start login errors", error);
        setInitializedLogin(true);
        return;
      }

      // Second "submit" starts here
      console.log("Verifying OTP");
      const {
        data: { session },
        error,
      } = await supabaseClient.auth.verifyOtp({
        email: formData.email,
        token: formData.otp,
        type: "email",
      });

      console.log("session", session);
      console.log("error", error);

      if (session) {
        await logUserIntoApp(session.user.user_metadata, pin);
      } else {
        console.log("No session found");
        setAdditionalError("No session found");
      }
    } catch (error: any) {
      console.log("error", error);
      setAdditionalError(error.message);
    }
  };

  // const [recievedMessage, setRecievedMessage] = useState("");

  // const sendMessage = () => {
  //   console.log("window1", window.parent);

  //   window.parent.postMessage("wallet", "http://localhost:3000");
  // };

  // useEffect(() => {
  //   window.addEventListener("message", function (e) {
  //     console.log("child", e);

  //     if (e.origin !== "http://localhost:3000") return;
  //     setRecievedMessage("Got this message from parent: " + e.data);
  //   });
  // }, []);

  useEffect(() => {
    supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
      console.log("user nav", session);

      if (session) {
        console.log("navb", localStorage.getItem("deviceprivatekey"));
        const user = session.user;
        const deviceKey = localStorage.getItem("deviceprivatekey");
        console.log(
          "🚀 ~ file: RequireUserLoggedIn.tsx:344 ~ supabaseClient.auth.getSession ~ user:",
          user
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedKey = await convertStringToCryptoKey(deviceKey!);
        const exampleData = decryptData(
          user!.user_metadata.device_encrypted_private_key,
          encryptedKey,
          iv
        );
        setDevicePrivateKey(localStorage.getItem("deviceprivatekey")!);
        console.log(
          "🚀 ~ file: LoginWithEmail.tsx:30 ~ login ~ exampleData:",
          exampleData
        );
        // setLocalAccount(exampleData);
        setUser(user!);
        setLoggedIn(true);
      } else {
        // alert("Error Accessing User");
      }
    });
  }, []);

  console.log("Outermost wallet:", wallet);
  if (!loggedIn) {
    return (
      <>
        {/* <div>
          <Typography variant={"h5"}>PIN (Always required)</Typography>
          <TextField
            label={"Decrypt Pin"}
            type={"password"}
            onChange={(e) => setPin(e.target.value)}
            defaultValue={localStorage.getItem("pin")}
            value={pin}
          />
          <Typography variant={"h5"}>Password login</Typography>
          <form onSubmit={emailPassHandleSubmit(emailPassSubmit)}>
            <TextField
              {...emailPassRegister("email", { required: true })}
              label={"Email"}
              type={"email"}
              helperText={emailPassErrors.email?.message}
              error={!!emailPassErrors.email}
              defaultValue={"test3@test.com"}
            />
            <TextField
              {...emailPassRegister("password", { required: true })}
              label={"Password"}
              type={"password"}
              helperText={emailPassErrors.email?.message}
              error={!!emailPassErrors.email}
              defaultValue={"password"}
            />
            <Button type="submit">Login</Button>
            <Typography color={"error"}>{additionalError}</Typography>
          </form>
          <Typography variant={"h5"}>OTP/Magic Link Signin</Typography>
          <form onSubmit={verifyOtpHandleSubmit(verifyOtpSubmit)}>
            <TextField
              {...verifyOtpRegister("email", { required: true })}
              label={"Email"}
              type={"email"}
              helperText={verifyOtpErrors.email?.message}
              error={!!verifyOtpErrors.email}
            />
            <TextField
              {...verifyOtpRegister("otp", { required: initializedLogin })}
              label={"OTP"}
              type={"text"}
              disabled={!initializedLogin}
              helperText={verifyOtpErrors.otp?.message}
              error={!!verifyOtpErrors.otp}
            />
            <Button type="submit">Login</Button>
            <Typography color={"error"}>{additionalError}</Typography>
          </form>
        </div> */}
        {/* <button onClick={sendMessage}>Send message to parent</button> */}
        {/* <p>received from parent: {recievedMessage}</p> */}
        <Card className=" p-8 bg-slate-100">
          <Tabs defaultValue="magic-link" className="w-[400px]">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger className="bg-slate-200" value="password">
                Password
              </TabsTrigger>
              <TabsTrigger className="bg-slate-200" value="magic-link">
                Magic Link
              </TabsTrigger>
            </TabsList>
            <form onSubmit={emailPassHandleSubmit(emailPassSubmit)}>
              <TabsContent value="password">
                <Card>
                  <CardHeader>
                    <CardTitle>Password Login</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        {...emailPassRegister("email", { required: true })}
                        defaultValue={"test3@test.com"}
                        type="email"
                        id="email"
                        placeholder="test3@test.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        {...emailPassRegister("password", { required: true })}
                        type="password"
                        id="password"
                        defaultValue="password"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="email">Pin</Label>
                      <Input
                        type={"password"}
                        onChange={(e) => setPin(e.target.value)}
                        defaultValue={localStorage.getItem("pin") ?? ""}
                        value={pin}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="flex w-full items-center justify-center">
                    <Button
                      type="submit"
                      variant="outline"
                      className="px-4 w-full text-lg font-semibold tracking-wide"
                    >
                      Submit
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>
            </form>
            <form onSubmit={verifyOtpHandleSubmit(verifyOtpSubmit)}>
              <TabsContent value="magic-link">
                <Card>
                  <CardHeader>
                    <CardTitle>Magic Link/OTP</CardTitle>
                  </CardHeader>
                  <CardContent className="flex gap-2 relative">
                    <CiMail className="absolute left-9 bottom-9" />
                    <Input
                      {...verifyOtpRegister("email", { required: true })}
                      placeholder="test3@test.com"
                      className="pl-8"
                      id="email2"
                      type="email"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      className="px-4 w-20 text-base font-semibold tracking-tighter"
                    >
                      Submit
                    </Button>
                    {/* <div className="space-y-1">
                    <Label htmlFor="otp">OTP Code</Label>
                    <Input id="otp" type="password" placeholder="Code" />
                  </div> */}
                  </CardContent>
                </Card>
              </TabsContent>
            </form>
          </Tabs>
          <div className="flex mt-2 gap-4 w-full">
            <Button
              variant="outline"
              className="border flex items-center justify-center px-8 w-1/3  rounded-md"
            >
              <IoKey className="w-8 h-8" />
            </Button>
            <Button
              variant="outline"
              disabled
              className="border cursor-not-allowed flex items-center justify-center px-8 w-1/3  rounded-md"
            >
              <FaTwitter className="w-7 h-7 fill-current " />
            </Button>
            <Button
              variant="outline"
              disabled
              className="border flex cursor-not-allowed items-center justify-center px-8 w-1/3  rounded-md"
            >
              <FaDiscord className="w-8 h-8" />
            </Button>
          </div>
          <div className="w-full mt-3">
            <Accordion type="single" collapsible className="w-full border-none">
              <AccordionItem value="item-1">
                <AccordionTrigger>
                  {" "}
                  <Button
                    variant="outline"
                    className="border  font-semibold text-lg tracking-tighter flex items-center justify-center px-8 w-full  rounded-md"
                  >
                    Connect Wallet
                  </Button>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col space-y-2">
                  <Button
                    variant="outline"
                    className="w-full flex justify-between"
                  >
                    <div className="flex gap-2">
                      <img
                        width={24}
                        height={24}
                        src="/metamask.svg"
                        alt="metamask"
                      />
                      <span className="flex-1 text-base font-semibold ms-3 whitespace-nowrap">
                        MetaMask
                      </span>
                    </div>
                    <span className="inline-flex items-center justify-center px-2 py-0.5 ms-3 text-xs font-medium text-gray-500 bg-gray-200 rounded dark:bg-gray-700 dark:text-gray-400">
                      Popular
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full flex justify-between"
                  >
                    <div className="flex gap-2">
                      <img
                        width={24}
                        height={24}
                        src="/coinbase.svg"
                        className="rounded-lg"
                        alt="coinbase"
                      />
                      <span className="flex-1 text-base font-semibold ms-3 whitespace-nowrap">
                        Coinbase Wallet
                      </span>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full flex justify-between"
                  >
                    <div className="flex gap-2">
                      <img
                        width={24}
                        height={24}
                        src="/wallet-connect.svg"
                        className="rounded-lg"
                        alt="wallet-connect"
                      />
                      <span className="flex-1 text-base font-semibold ms-3 whitespace-nowrap">
                        WalletConnect
                      </span>
                    </div>
                  </Button>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </Card>
      </>
    );
  }
  return (
    <DeviceKeyContext.Provider
      value={{
        deviceKey: devicePrivateKey,
        pin,
        wallet,
      }}
    >
      {children}
    </DeviceKeyContext.Provider>
  );
};