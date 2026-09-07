# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

cmake_minimum_required(VERSION 3.13)

# Define target_compile_reactnative_options macro if not provided by React Native (added in RN 0.81)
if(NOT COMMAND target_compile_reactnative_options)
  macro(target_compile_reactnative_options TARGET SCOPE)
    # Compatibility shim for React Native < 0.81
  endmacro()
endif()

# Define the library name here.
project(appmodules)

# This file includes all the necessary to let you build your application with the New Architecture.
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
