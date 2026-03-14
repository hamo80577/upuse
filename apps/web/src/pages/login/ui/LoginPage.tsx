import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { Alert, Box, Button, Card, Container, IconButton, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { describeApiError } from "../../../api/client";
import { useAuth } from "../../../app/providers/AuthProvider";
import { BrandLockup } from "../../../widgets/top-bar/ui/BrandLockup";

const fieldSx = {
  "& .MuiOutlinedInput-root": {
    height: 54,
    borderRadius: 3,
    bgcolor: "rgba(255,255,255,0.92)",
    transition: "border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease",
    "& fieldset": {
      borderColor: "rgba(148,163,184,0.28)",
    },
    "&:hover fieldset": {
      borderColor: "rgba(100,116,139,0.42)",
    },
    "&.Mui-focused": {
      bgcolor: "#ffffff",
      boxShadow: "0 0 0 4px rgba(15,23,42,0.05)",
    },
  },
};

const LOGIN_VISUAL_ROTATE_MS = 2800;

const loginHeroVisuals = [
  {
    key: "login",
    src: "/login_page.png",
    alt: "UPuse login visual",
    width: "95%",
    maxWidth: 640,
    activeTransform: "translate3d(0, 0, 0) scale(1.04) rotate(0deg)",
    inactiveTransform: "translate3d(-56px, 42px, 0) scale(0.84) rotate(-9deg)",
    activeFilter: "blur(0px) saturate(1.02) drop-shadow(0 38px 62px rgba(15,23,42,0.14))",
    inactiveFilter: "blur(8px) saturate(0.92) drop-shadow(0 14px 26px rgba(15,23,42,0.07))",
  },
  {
    key: "brand",
    src: "/img1.png",
    alt: "UPuse brand visual",
    width: "84%",
    maxWidth: 560,
    activeTransform: "translate3d(0, 0, 0) scale(1.08) rotate(0deg)",
    inactiveTransform: "translate3d(58px, -34px, 0) scale(0.8) rotate(10deg)",
    activeFilter: "blur(0px) saturate(1.04) drop-shadow(0 34px 56px rgba(15,23,42,0.16))",
    inactiveFilter: "blur(8px) saturate(0.9) drop-shadow(0 12px 22px rgba(15,23,42,0.06))",
  },
] as const;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [activeVisual, setActiveVisual] = useState<(typeof loginHeroVisuals)[number]["key"]>("login");

  const nextPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || "/";

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveVisual((current) => (current === "login" ? "brand" : "login"));
    }, LOGIN_VISUAL_ROTATE_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    try {
      setSubmitting(true);
      setError("");
      await login({ email, password });
      navigate(nextPath, { replace: true });
    } catch (submitError) {
      setError(describeApiError(submitError, "Failed to sign in"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        py: { xs: 3, md: 5 },
        bgcolor: "#f4f6fb",
        background:
          "radial-gradient(circle at top left, rgba(244, 190, 212, 0.14), transparent 28%), radial-gradient(circle at bottom right, rgba(191, 219, 254, 0.16), transparent 32%), linear-gradient(180deg, #f7f8fc 0%, #eff4f8 100%)",
      }}
    >
      <Container maxWidth="xl">
        <Card
          sx={{
            overflow: "hidden",
            borderRadius: { xs: 4, md: 6 },
            border: "1px solid rgba(226,232,240,0.95)",
            boxShadow: "0 30px 70px rgba(15,23,42,0.08)",
            bgcolor: "rgba(255,255,255,0.94)",
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "420px minmax(0, 1fr)" },
              minHeight: { lg: 640 },
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                px: { xs: 2.5, sm: 4, lg: 5 },
                py: { xs: 3, lg: 4.5 },
                borderRight: { lg: "1px solid rgba(226,232,240,0.95)" },
              }}
            >
              <Stack component="form" spacing={2.2} onSubmit={onSubmit} sx={{ width: "100%", maxWidth: 320 }}>
                <BrandLockup variant="auth" />

                <Box sx={{ pt: 1 }}>
                  <Typography
                    sx={{
                      fontSize: { xs: 34, md: 40 },
                      lineHeight: 0.98,
                      letterSpacing: "-0.05em",
                      fontWeight: 900,
                      color: "#0f172a",
                    }}
                  >
                    Log In
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, color: "#64748b" }}>
                    Continue with your account.
                  </Typography>
                </Box>

                {error ? (
                  <Alert severity="error" variant="outlined" sx={{ borderRadius: 3 }}>
                    {error}
                  </Alert>
                ) : null}

                <Stack spacing={0.8}>
                  <Typography variant="caption" sx={{ color: "#475569", fontWeight: 800 }}>
                    Email
                  </Typography>
                  <TextField
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    fullWidth
                    required
                    sx={fieldSx}
                  />
                </Stack>

                <Stack spacing={0.8}>
                  <Typography variant="caption" sx={{ color: "#475569", fontWeight: 800 }}>
                    Password
                  </Typography>
                  <TextField
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    fullWidth
                    required
                    sx={fieldSx}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            type="button"
                            onClick={() => setShowPassword((current) => !current)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            edge="end"
                            sx={{
                              color: "#64748b",
                              "&:hover": {
                                bgcolor: "transparent",
                                color: "#0f172a",
                              },
                            }}
                          >
                            {showPassword ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Stack>

                <Button
                  type="submit"
                  variant="contained"
                  startIcon={<LoginRoundedIcon />}
                  disabled={submitting}
                  sx={{
                    mt: 0.6,
                    height: 52,
                    borderRadius: 999,
                    bgcolor: "#cf87a8",
                    boxShadow: "0 16px 28px rgba(207,135,168,0.24)",
                    fontWeight: 900,
                    letterSpacing: "0.01em",
                    "&:hover": {
                      bgcolor: "#c47b9d",
                      boxShadow: "0 18px 32px rgba(207,135,168,0.28)",
                    },
                  }}
                >
                  {submitting ? "Signing in..." : "Login"}
                </Button>
              </Stack>
            </Box>

            <Box
              sx={{
                position: "relative",
                display: { xs: "none", lg: "flex" },
                alignItems: "center",
                justifyContent: "center",
                px: 4.5,
                py: 4.5,
                bgcolor: "#f7eef3",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  inset: { lg: 28, xl: 34 },
                  borderRadius: 5,
                  background:
                    activeVisual === "login"
                      ? "linear-gradient(180deg, #dfeef8 0%, #e8f2f8 100%)"
                      : "linear-gradient(180deg, #f8e8f0 0%, #efe4da 100%)",
                  transition: "background 720ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />

              <Box
                sx={{
                  position: "relative",
                  zIndex: 1,
                  width: "100%",
                  maxWidth: 780,
                  minHeight: 560,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Box
                  sx={{
                    position: "relative",
                    width: "100%",
                    maxWidth: 700,
                    minHeight: 520,
                  }}
                >
                  <Box
                    sx={{
                      position: "absolute",
                      inset: "8% 4% 4% 8%",
                      borderRadius: "42px",
                      background:
                        activeVisual === "login"
                          ? "radial-gradient(circle at 26% 24%, rgba(255,255,255,0.40), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.14) 100%)"
                          : "radial-gradient(circle at 72% 22%, rgba(255,255,255,0.38), transparent 32%), linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.12) 100%)",
                      transform: activeVisual === "login" ? "scale(1) rotate(-1deg)" : "scale(1.03) rotate(1deg)",
                      boxShadow:
                        activeVisual === "login"
                          ? "0 28px 54px rgba(148,163,184,0.16)"
                          : "0 32px 60px rgba(207,135,168,0.16)",
                      transition:
                        "background 720ms cubic-bezier(0.22, 1, 0.36, 1), transform 980ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 980ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  />

                  <Box
                    sx={{
                      position: "absolute",
                      inset: "4% 10% 14% 6%",
                      borderRadius: "50%",
                      background:
                        activeVisual === "login"
                          ? "radial-gradient(circle, rgba(191,219,254,0.38) 0%, rgba(191,219,254,0) 72%)"
                          : "radial-gradient(circle, rgba(244,190,212,0.34) 0%, rgba(244,190,212,0) 72%)",
                      filter: "blur(18px)",
                      transform: activeVisual === "login" ? "translateX(0)" : "translateX(18px)",
                      transition:
                        "background 720ms cubic-bezier(0.22, 1, 0.36, 1), transform 980ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  />

                  {loginHeroVisuals.map((visual) => {
                    const isActive = activeVisual === visual.key;

                    return (
                      <Box
                        key={visual.key}
                        component="img"
                        src={visual.src}
                        alt={visual.alt}
                        sx={{
                          position: "absolute",
                          inset: 0,
                          margin: "auto",
                          width: visual.width,
                          maxWidth: visual.maxWidth,
                          maxHeight: 470,
                          objectFit: "contain",
                          display: "block",
                          opacity: isActive ? 1 : 0,
                          transform: isActive ? visual.activeTransform : visual.inactiveTransform,
                          filter: isActive ? visual.activeFilter : visual.inactiveFilter,
                          transition:
                            "opacity 620ms cubic-bezier(0.22, 1, 0.36, 1), transform 1080ms cubic-bezier(0.22, 1, 0.36, 1), filter 1080ms cubic-bezier(0.22, 1, 0.36, 1)",
                          transformOrigin: "center",
                          willChange: "opacity, transform, filter",
                          pointerEvents: "none",
                          animation: isActive
                            ? "loginHeroReveal 1080ms cubic-bezier(0.16, 1, 0.3, 1)"
                            : "loginHeroDismiss 780ms cubic-bezier(0.55, 0, 0.15, 1)",
                          "@media (prefers-reduced-motion: reduce)": {
                            transition: "none",
                            animation: "none",
                          },
                          "@keyframes loginHeroReveal": {
                            "0%": {
                              opacity: 0,
                              transform: "translate3d(0, 46px, 0) scale(0.8) rotate(-10deg)",
                              filter: "blur(10px) saturate(0.9) drop-shadow(0 10px 16px rgba(15,23,42,0.05))",
                            },
                            "55%": {
                              opacity: 1,
                              transform: "translate3d(0, -10px, 0) scale(1.08) rotate(1deg)",
                            },
                            "100%": {
                              opacity: 1,
                            },
                          },
                          "@keyframes loginHeroDismiss": {
                            "0%": {
                              opacity: 1,
                            },
                            "100%": {
                              opacity: 0,
                              transform: "translate3d(0, -36px, 0) scale(0.82) rotate(8deg)",
                              filter: "blur(10px) saturate(0.9) drop-shadow(0 8px 14px rgba(15,23,42,0.05))",
                            },
                          },
                        }}
                      />
                    );
                  })}
                </Box>
              </Box>
            </Box>
          </Box>
        </Card>
      </Container>
    </Box>
  );
}
